"""
chat.py — LLM Q&A endpoint: Claude Haiku + tool-use execute_sql + SSE streaming.
"""
import os
import re
import json
from pathlib import Path

import anthropic
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from db import query

ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT / ".env")

router = APIRouter(prefix="/api/chat", tags=["chat"])

SCHEMA_CONTEXT = """Bạn là trợ lý phân tích dữ liệu của Công ty Xe đạp Thống Nhất (tnbike).
Database: PostgreSQL, schema tnbike.

=== CÁC BẢNG CHÍNH ===
fact_sales (25.754 rows) — bảng analytics ưu tiên:
  order_date, fiscal_year, fiscal_quarter, fiscal_month, week_of_year
  so_number, order_id, line_id
  customer_code, customer_name, province_name, region (Miền Bắc/Miền Trung/Miền Nam)
  product_code, product_name, color, line_name, group_code, group_name
  quantity, unit_price, line_total

sales_order (2.759 rows): order_id, so_number, order_date, customer_code, total_amount, total_quantity, line_count
order_line (25.754 rows): line_id, order_id, so_number, product_code, quantity, unit_price, line_total
customer (798 rows): customer_code, customer_name, tax_code, province_id, customer_tier, is_active
product (265 rows): product_code, product_name, line_id, color, is_active
product_line (77 rows): line_id, line_name, group_code
product_group (5 rows): group_code, group_name — values: CITYBIKE_P/KIDBIKE_1/KIDBIKE_2/SPORTBIKE_S/SPORTBIKE_A
province (75 rows): province_id, province_name, region
email_log (1.132 rows): message_id, from_address, so_number, processing_status, error_message

=== VIEWS ===
v_customer_activity: customer_code, customer_name, province_name, region, total_orders, total_revenue, first_order_date, last_order_date, days_since_last_order
v_monthly_by_group: fiscal_year, fiscal_month, group_code, group_name, order_count, total_qty, total_revenue, avg_unit_price

=== QUY TẮC ===
- Dữ liệu: 2025-01 đến 2026-03 (T3/2026 = tháng 3 năm 2026 mới nhất)
- Luôn dùng fact_sales cho analytics (nhanh hơn JOIN thủ công)
- Số tiền đơn vị VND (hiển thị X tỷ = X/1.000.000.000)
- Churn: days_since_last_order > 45 ngày
- 72/265 SKU có line_name = NULL (chưa phân loại)
- Trả lời bằng tiếng Việt, súc tích, có số liệu cụ thể."""

TOOLS = [
    {
        "name": "execute_sql",
        "description": "Execute a SELECT SQL query against the tnbike PostgreSQL database. Use this to answer analytical questions about sales, products, customers, and geography.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "A valid PostgreSQL SELECT statement using the tnbike schema."
                }
            },
            "required": ["query"]
        }
    }
]


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


def run_sql_safe(sql: str) -> str:
    """Execute SQL, return result as formatted string. Guard: SELECT only."""
    cleaned = sql.strip()
    if not re.match(r'^\s*SELECT', cleaned, re.IGNORECASE):
        return "Lỗi: Chỉ hỗ trợ truy vấn SELECT."
    try:
        df = query(cleaned)
        if df.empty:
            return "Không có dữ liệu."
        # Limit rows for LLM context
        preview = df.head(50)
        return preview.to_string(index=False, max_cols=10)
    except Exception as e:
        return f"Lỗi truy vấn: {str(e)}"


def _sse(text: str) -> str:
    return f"data: {json.dumps({'text': text})}\n\n"


@router.post("")
async def chat(req: ChatRequest):
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        async def err():
            yield _sse("Lỗi: ANTHROPIC_API_KEY chưa được cấu hình trong file .env")
        return StreamingResponse(err(), media_type="text/event-stream")

    client = anthropic.Anthropic(api_key=api_key)

    messages = req.history[-10:] + [{"role": "user", "content": req.message}]

    async def generate():
        # Round 1: Claude might use tool
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            system=[{
                "type": "text",
                "text": SCHEMA_CONTEXT,
                "cache_control": {"type": "ephemeral"}
            }],
            tools=TOOLS,
            messages=messages,
        )

        # Handle tool use
        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use" and block.name == "execute_sql":
                    yield _sse("⏳ Đang truy vấn cơ sở dữ liệu...\n\n")
                    result = run_sql_safe(block.input.get("query", ""))
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })

            # Round 2: Claude generates final answer (stream it)
            messages_r2 = messages + [
                {"role": "assistant", "content": response.content},
                {"role": "user", "content": tool_results},
            ]
            with client.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=1024,
                system=[{
                    "type": "text",
                    "text": SCHEMA_CONTEXT,
                    "cache_control": {"type": "ephemeral"}
                }],
                messages=messages_r2,
            ) as stream:
                for text in stream.text_stream:
                    yield _sse(text)
        else:
            # No tool use — stream direct answer
            with client.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=1024,
                system=[{
                    "type": "text",
                    "text": SCHEMA_CONTEXT,
                    "cache_control": {"type": "ephemeral"}
                }],
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield _sse(text)

        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
