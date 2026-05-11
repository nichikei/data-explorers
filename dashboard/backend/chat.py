"""
chat.py — LLM Q&A endpoint: Gemini Flash + function calling execute_sql + SSE streaming.
"""
import os
import re
import json
from pathlib import Path

from google import genai
from google.genai import types
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from db import query

for _p in Path(__file__).resolve().parents:
    if (_p / ".env").exists():
        load_dotenv(_p / ".env")
        break

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

EXECUTE_SQL_FN = types.FunctionDeclaration(
    name="execute_sql",
    description="Execute a SELECT SQL query against the tnbike PostgreSQL database. Use this to answer analytical questions about sales, products, customers, and geography.",
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "query": types.Schema(
                type=types.Type.STRING,
                description="A valid PostgreSQL SELECT statement using the tnbike schema.",
            )
        },
        required=["query"],
    ),
)

GEMINI_TOOL = types.Tool(function_declarations=[EXECUTE_SQL_FN])
MODEL = "gemini-2.0-flash"


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


def run_sql_safe(sql: str) -> str:
    """Execute SQL (SELECT only), return result as string for LLM context."""
    if not re.match(r"^\s*SELECT", sql.strip(), re.IGNORECASE):
        return "Lỗi: Chỉ hỗ trợ truy vấn SELECT."
    try:
        df = query(sql.strip())
        if df.empty:
            return "Không có dữ liệu."
        return df.head(50).to_string(index=False, max_cols=10)
    except Exception as e:
        return f"Lỗi truy vấn: {e}"


def _sse(text: str) -> str:
    return f"data: {json.dumps({'text': text})}\n\n"


def build_contents(history: list[dict], message: str) -> list:
    """Convert history [{role, content}] → Gemini contents list."""
    contents = []
    for msg in history[-10:]:
        role = "model" if msg["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": msg["content"]}]})
    contents.append({"role": "user", "parts": [{"text": message}]})
    return contents


@router.post("")
async def chat(req: ChatRequest):
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        async def err():
            yield _sse("⚠️ GEMINI_API_KEY chưa được cấu hình trong file .env")
            yield "data: [DONE]\n\n"
        return StreamingResponse(err(), media_type="text/event-stream")

    client = genai.Client(api_key=api_key)
    contents = build_contents(req.history, req.message)

    round1_cfg = types.GenerateContentConfig(
        system_instruction=SCHEMA_CONTEXT,
        tools=[GEMINI_TOOL],
        temperature=0.1,
        max_output_tokens=2048,
    )
    round2_cfg = types.GenerateContentConfig(
        system_instruction=SCHEMA_CONTEXT,
        temperature=0.2,
        max_output_tokens=1024,
    )

    async def generate():
        try:
            # Round 1 — non-streaming to detect function call
            r1 = client.models.generate_content(
                model=MODEL,
                contents=contents,
                config=round1_cfg,
            )

            # Extract function call if present
            fn_call = None
            if r1.candidates:
                for part in r1.candidates[0].content.parts:
                    if hasattr(part, "function_call") and part.function_call and part.function_call.name:
                        fn_call = part.function_call
                        break

            if fn_call:
                yield _sse("⏳ Đang truy vấn cơ sở dữ liệu...\n\n")
                sql_result = run_sql_safe(fn_call.args.get("query", ""))

                # Append model turn (with function_call) + tool result
                contents.append({
                    "role": "model",
                    "parts": [{"function_call": {"name": fn_call.name, "args": dict(fn_call.args)}}],
                })
                contents.append({
                    "role": "user",
                    "parts": [{"function_response": {"name": fn_call.name, "response": {"result": sql_result}}}],
                })

                # Round 2 — stream final answer
                for chunk in client.models.generate_content_stream(
                    model=MODEL,
                    contents=contents,
                    config=round2_cfg,
                ):
                    if chunk.text:
                        yield _sse(chunk.text)
            else:
                # No tool needed — re-stream direct answer
                for chunk in client.models.generate_content_stream(
                    model=MODEL,
                    contents=contents,
                    config=round1_cfg,
                ):
                    if chunk.text:
                        yield _sse(chunk.text)

        except Exception as e:
            yield _sse(f"Lỗi Gemini API: {e}")

        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
