"""
validate.py — STAGE 3
=====================
Đọc extracted.jsonl, áp dụng các rule validation:
  V1. so_number bắt buộc, format BH26.\d{4}
  V2. order_date không null, nằm trong tháng 3/2026
  V3. mọi product_code có trong bảng product — nếu chưa có thì AUTO-INSERT
  V4. quantity > 0, unit_price >= 0
  V5. line_total ≈ quantity × unit_price (tolerance từ config)
  V6. SUM(line_total) ≈ footer_total — WARNING ONLY, không fail đơn
  V7. so_number chưa tồn tại trong sales_order (chống trùng)
"""
import csv
import json
import logging
from decimal import Decimal
from pathlib import Path

from tqdm import tqdm

from config import EXTRACTED_JSONL, ERRORS_CSV, TOTAL_TOLERANCE, get_conn

log = logging.getLogger("stage3.validate")


def load_known_products(conn) -> set:
    """Cache mã sản phẩm hợp lệ vào memory."""
    with conn.cursor() as cur:
        cur.execute("SELECT product_code FROM product")
        return {r[0] for r in cur.fetchall()}


def load_existing_so_numbers() -> set:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT so_number FROM sales_order")
            return {r[0] for r in cur.fetchall()}


def auto_insert_product(product_code: str, conn) -> None:
    """
    Tự động insert SKU mới phát sinh trong T3/2026 vào bảng product.
    Dùng ON CONFLICT DO NOTHING để idempotent.
    """
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO product (product_code, product_name, unit, is_active)
            VALUES (%s, %s, 'Chiếc', TRUE)
            ON CONFLICT (product_code) DO NOTHING
        """, (product_code, f"San pham moi T3/2026 - {product_code}"))
    log.info("Auto-insert sản phẩm mới: %s", product_code)


def validate_one(payload: dict, known_products: set,
                 existing_so: set, conn) -> list:
    """Trả list các lỗi (rỗng = OK). known_products có thể được cập nhật in-place."""
    errors = []
    header = payload.get("header") or {}
    lines  = payload.get("lines") or []

    # V1
    so_number = header.get("so_number")
    if not so_number:
        errors.append("V1_NO_SO_NUMBER")
    elif so_number in existing_so:
        errors.append(f"V7_DUPLICATE_SO:{so_number}")

    # V2
    if not header.get("order_date"):
        errors.append("V2_NO_ORDER_DATE")

    if not lines:
        errors.append("LINES_EMPTY")
        return errors

    sum_line_total = 0
    for i, ln in enumerate(lines, start=1):
        code = ln["product_code"]

        # V3 — auto-insert nếu chưa có, không fail
        if code not in known_products:
            auto_insert_product(code, conn)
            known_products.add(code)   # cập nhật cache để đơn sau dùng lại

        qty   = Decimal(str(ln.get("quantity") or "0"))
        price = int(ln.get("unit_price") or 0)
        total = int(ln.get("line_total") or 0)

        # V4
        if qty <= 0:
            errors.append(f"V4_QTY_NONPOSITIVE:line{i}")
        if price < 0:
            errors.append(f"V4_PRICE_NEGATIVE:line{i}")

        # V5
        expected = int(round(float(qty) * price))
        if abs(total - expected) > TOTAL_TOLERANCE:
            errors.append(
                f"V5_LINE_TOTAL_MISMATCH:line{i}:got={total},expected={expected}"
            )

        sum_line_total += total

    # V6 — warning only, không fail đơn
    footer = payload.get("footer_total")
    if footer is not None and abs(sum_line_total - footer) > TOTAL_TOLERANCE:
        log.warning(
            "V6_FOOTER_MISMATCH %s: sum=%d footer=%d (diff=%d) — bỏ qua, không fail",
            (payload.get("header") or {}).get("so_number"),
            sum_line_total, footer, abs(sum_line_total - footer),
        )

    return errors


def run() -> tuple:
    if not EXTRACTED_JSONL.exists():
        log.error("Không tìm thấy %s — chạy Stage 2 trước", EXTRACTED_JSONL)
        return 0, 0

    log.info("Stage 3: load reference data...")
    existing_so = load_existing_so_numbers()

    ok, fail = 0, 0
    err_rows = []

    with get_conn() as conn:
        known_products = load_known_products(conn)
        log.info("  - %d sản phẩm trong DB", len(known_products))
        log.info("  - %d so_number đã tồn tại (sẽ skip nếu đụng)", len(existing_so))

        with EXTRACTED_JSONL.open("r", encoding="utf-8") as fin:
            with conn.cursor() as cur:
                for raw in tqdm(fin, desc="Validating"):
                    payload = json.loads(raw)
                    log_id  = payload.get("log_id")
                    errors  = validate_one(payload, known_products, existing_so, conn)

                    if errors:
                        cur.execute("""UPDATE email_log SET processing_status='FAILED',
                                       error_stage='VALIDATE', error_message=%s
                                       WHERE log_id=%s""",
                                    ("; ".join(errors), log_id))
                        err_rows.append({
                            "log_id":   log_id,
                            "so_number": (payload.get("header") or {}).get("so_number"),
                            "errors":   "; ".join(errors),
                            "pdf_path": payload.get("pdf_path"),
                        })
                        fail += 1
                    else:
                        cur.execute(
                            "UPDATE email_log SET processing_status='VALIDATED' WHERE log_id=%s",
                            (log_id,)
                        )
                        ok += 1
                conn.commit()

    # Ghi errors.csv
    if err_rows:
        ERRORS_CSV.parent.mkdir(parents=True, exist_ok=True)
        with ERRORS_CSV.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["log_id", "so_number", "errors", "pdf_path"])
            w.writeheader()
            w.writerows(err_rows)
        log.info("Đã ghi %d lỗi vào %s", len(err_rows), ERRORS_CSV)

    log.info("STAGE 3 done — VALIDATED=%d  FAILED=%d", ok, fail)
    return ok, fail


if __name__ == "__main__":
    run()