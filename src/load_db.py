"""
load_db.py — STAGE 4
====================
Đọc các email_log có status='VALIDATED', insert vào DB:
  1. Resolve customer:
       a. Match exact tax_code → existing customer_code
       b. Fuzzy match customer_name → existing
       c. Tạo mới: KH-XXXXX (next_id từ MAX)
  2. INSERT sales_order (so_number UNIQUE, trigger sẽ auto fill total_*)
  3. INSERT order_line (FK order_id)
  4. UPDATE email_log: LOADED, processed_at=NOW()

Mỗi đơn = 1 transaction. Đơn lỗi rollback, đánh dấu FAILED, tiếp đơn sau.
"""
import json
import logging
import re
from typing import Optional

from rapidfuzz import fuzz, process
from tqdm import tqdm

from config import get_conn

log = logging.getLogger("stage4.load")


# ----------------------------------------------------------------------------
# Customer resolver
# ----------------------------------------------------------------------------
def normalize_name(name: str) -> str:
    """Bỏ dấu, lowercase, bỏ ký tự thừa — phục vụ fuzzy match."""
    if not name:
        return ""
    s = name.lower()
    s = re.sub(r"\s+", " ", s).strip()
    # Bỏ tiền tố thường gặp
    for prefix in ("công ty cổ phần", "công ty tnhh", "công ty cp", "cty tnhh", "cty"):
        if s.startswith(prefix):
            s = s[len(prefix):].strip()
    return s


class CustomerResolver:
    """
    Cache toàn bộ customer vào memory một lần, resolve bằng:
        1. tax_code (exact)
        2. normalized name (fuzzy ≥ 92)
        3. tạo mới — generate KH-XXXXX
    """
    def __init__(self):
        self.by_tax: dict[str, str]   = {}     # tax_code → customer_code
        self.by_norm_name: dict[str, str] = {} # normalized name → customer_code
        self.all_norm_names: list[str] = []
        self.next_id: int = 1
        self._load()

    def _load(self):
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT customer_code, customer_name, tax_code FROM customer"
                )
                for code, name, tax in cur.fetchall():
                    if tax:
                        self.by_tax[tax] = code
                    n = normalize_name(name)
                    if n:
                        self.by_norm_name[n] = code
                        self.all_norm_names.append(n)
                # next_id = max + 1
                cur.execute(
                    "SELECT COALESCE(MAX(SUBSTRING(customer_code FROM 4)::INT), 0) "
                    "FROM customer WHERE customer_code ~ '^KH-\\d+$'"
                )
                self.next_id = (cur.fetchone()[0] or 0) + 1

    def resolve(self, conn, name: str, tax_code: Optional[str],
                address: Optional[str]) -> str:
        # 1) exact tax_code
        if tax_code and tax_code in self.by_tax:
            return self.by_tax[tax_code]

        # 2) fuzzy name
        norm = normalize_name(name)
        if not tax_code and norm and self.all_norm_names:
            best, score, _ = process.extractOne(
                norm, self.all_norm_names, scorer=fuzz.token_set_ratio
            ) or (None, 0, None)
            if best and score >= 92:
                return self.by_norm_name[best]

        # 3) new customer
        new_code = f"KH-{self.next_id:05d}"
        self.next_id += 1

        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO customer (customer_code, customer_name, tax_code,
                                      address, customer_tier, is_active)
                VALUES (%s, %s, %s, %s, 'STANDARD', TRUE)
                ON CONFLICT (customer_code) DO NOTHING
            """, (new_code, name, tax_code, address))

        # cache
        if tax_code:
            self.by_tax[tax_code] = new_code
        if norm:
            self.by_norm_name[norm] = new_code
            self.all_norm_names.append(norm)
        log.info("Tạo mới đại lý %s (%s, MST=%s)", new_code, name, tax_code)
        return new_code


# ----------------------------------------------------------------------------
# Insert one order — atomic
# ----------------------------------------------------------------------------
INSERT_SO_SQL = """
INSERT INTO sales_order (so_number, invoice_symbol, invoice_number,
                         order_date, customer_code)
VALUES (%s, NULL, NULL, %s, %s)
RETURNING order_id;
"""

INSERT_LINE_SQL = """
INSERT INTO order_line (order_id, so_number, product_code,
                        quantity, unit_price, line_total)
VALUES (%s, %s, %s, %s, %s, %s);
"""


def load_one(conn, payload: dict, resolver: CustomerResolver) -> Optional[int]:
    """Insert 1 đơn (sales_order + order_lines) trong 1 transaction. Trả order_id."""
    header = payload["header"]
    lines  = payload["lines"]

    customer_code = resolver.resolve(
        conn,
        name=header.get("customer_name") or "Khách lẻ",
        tax_code=header.get("tax_code"),
        address=header.get("address"),
    )

    with conn.cursor() as cur:
        cur.execute(INSERT_SO_SQL, (
            header["so_number"],
            header["order_date"],
            customer_code,
        ))
        order_id = cur.fetchone()[0]

        for ln in lines:
            cur.execute(INSERT_LINE_SQL, (
                order_id,
                header["so_number"],
                ln["product_code"],
                ln["quantity"],
                ln["unit_price"],
                ln["line_total"],
            ))
        # Trigger fn_update_order_totals tự update total_amount, total_quantity, line_count
    return order_id


# ----------------------------------------------------------------------------
# Run
# ----------------------------------------------------------------------------
def run() -> tuple[int, int]:
    log.info("Stage 4: load CustomerResolver cache...")
    resolver = CustomerResolver()
    log.info("  - by_tax=%d, by_name=%d, next_id=KH-%05d",
             len(resolver.by_tax), len(resolver.by_norm_name), resolver.next_id)

    # Lấy danh sách payload đã VALIDATED
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT log_id, extracted_payload
                FROM email_log
                WHERE processing_status = 'VALIDATED'
                ORDER BY log_id
            """)
            rows = cur.fetchall()

    if not rows:
        log.warning("Không có đơn nào VALIDATED — Stage 4 skip")
        return 0, 0

    log.info("Stage 4: load %d đơn vào DB", len(rows))
    ok, fail = 0, 0

    for log_id, payload_json in tqdm(rows, desc="Loading DB"):
        payload = payload_json if isinstance(payload_json, dict) else json.loads(payload_json)
        # Mỗi đơn 1 connection riêng → mỗi đơn 1 transaction độc lập
        try:
            with get_conn() as conn:
                order_id = load_one(conn, payload, resolver)
                with conn.cursor() as cur:
                    cur.execute("""UPDATE email_log
                                   SET processing_status='LOADED', processed_at=NOW(),
                                       error_stage=NULL, error_message=NULL
                                   WHERE log_id=%s""", (log_id,))
                conn.commit()
            ok += 1
        except Exception as e:
            log.error("[log_id=%s] LOAD FAILED: %s", log_id, e)
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("""UPDATE email_log
                                   SET processing_status='FAILED',
                                       error_stage='LOAD', error_message=%s
                                   WHERE log_id=%s""", (str(e)[:500], log_id))
                conn.commit()
            fail += 1

    log.info("STAGE 4 done — LOADED=%d  FAILED=%d", ok, fail)
    return ok, fail


if __name__ == "__main__":
    run()
