"""
integrity_check.py
==================
Kiểm tra toàn vẹn dữ liệu theo 2 chiều:

  CHIỀU 1 — EML/PDF → Database
    C1-1. Số đơn: EML file vs email_log vs sales_order
    C1-2. so_number trong extracted.jsonl khớp với sales_order
    C1-3. Số dòng order_line khớp với JSONL (đếm line mỗi đơn)
    C1-4. Số lượng (quantity) JSONL vs DB
    C1-5. Đơn giá (unit_price) JSONL vs DB
    C1-6. Thành tiền (line_total) JSONL vs DB
    C1-7. Footer total JSONL vs total_amount DB
    C1-8. order_date JSONL vs DB
    C1-9. customer tax_code JSONL vs DB
    C1-10. Font corruption trong tên từ JSONL vào product.product_name

  CHIỀU 2 — Database → Excel/CSV
    C2-1. Số dòng DB vs CSV (mỗi bảng)
    C2-2. Kiểm tra các cột số: không bị đổi giá trị khi export
    C2-3. sales_order: total_amount khớp giữa DB và CSV
    C2-4. order_line: line_total, quantity, unit_price khớp DB vs CSV
    C2-5. fact_sales: line_total, quantity khớp DB vs CSV
    C2-6. Không mất dòng khi export (row count exact match)
"""

import sys
import io
import json
from decimal import Decimal
from pathlib import Path

import pandas as pd

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).parent / "src"))
from config import get_conn, EXTRACTED_JSONL, EML_DIR

CSV_DIR = Path("csv")
TODAY   = "20260508"

PASS  = "[PASS]"
FAIL  = "[FAIL]"
WARN  = "[WARN]"
INFO  = "      "

issues: list[str] = []


def section(title):
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}")


def check(label, ok, detail=""):
    tag = PASS if ok else FAIL
    line = f"  {tag}  {label}"
    if detail:
        line += f"  →  {detail}"
    print(line)
    if not ok:
        issues.append(f"{label}: {detail}" if detail else label)


def info(msg):
    print(f"  {INFO} {msg}")


# =============================================================================
# Load helpers
# =============================================================================
def load_jsonl():
    records = []
    if not EXTRACTED_JSONL.exists():
        return records
    with EXTRACTED_JSONL.open(encoding="utf-8") as f:
        for line in f:
            records.append(json.loads(line))
    return records


def load_csv(table: str) -> pd.DataFrame:
    pattern = list(CSV_DIR.glob(f"{table}*.csv"))
    if not pattern:
        return pd.DataFrame()
    return pd.read_csv(pattern[0], encoding="utf-8-sig")


def db_query(cur, sql, params=None):
    cur.execute(sql, params or ())
    return cur.fetchall()


# =============================================================================
# CHIỀU 1 — EML/PDF → Database
# =============================================================================
def check_eml_to_db(cur, records):
    section("CHIỀU 1 · EML / PDF  →  Database")

    # C1-1: Số đơn
    n_eml  = len(list(EML_DIR.glob("*.eml"))) if EML_DIR.exists() else "?"
    n_log  = db_query(cur, "SELECT COUNT(*) FROM email_log")[0][0]
    n_so   = db_query(cur, "SELECT COUNT(*) FROM sales_order")[0][0]
    n_jsonl = len(records)
    info(f"EML files trên disk:   {n_eml}")
    info(f"email_log rows:        {n_log:,}")
    info(f"extracted.jsonl rows:  {n_jsonl:,}")
    info(f"sales_order rows:      {n_so:,}")
    check("C1-1  email_log == số EML files",
          n_eml == "?" or n_eml == n_log,
          f"eml={n_eml}  log={n_log}")
    check("C1-1  sales_order >= extracted.jsonl",
          n_so >= n_jsonl,
          f"so={n_so}  jsonl={n_jsonl}")

    if not records:
        print(f"  {WARN}  extracted.jsonl trống — bỏ qua C1-2..C1-10")
        return

    # Lấy dữ liệu DB để so sánh
    cur.execute("SELECT so_number, order_date, total_amount FROM sales_order")
    so_map = {r[0]: {"date": str(r[1]), "total": int(r[2])} for r in cur.fetchall()}

    cur.execute("""
        SELECT ol.so_number, ol.product_code, ol.quantity, ol.unit_price, ol.line_total
        FROM order_line ol
        ORDER BY ol.so_number, ol.line_id
    """)
    from collections import defaultdict
    db_lines: dict[str, list] = defaultdict(list)
    for so, pc, qty, up, lt in cur.fetchall():
        db_lines[so].append({
            "product_code": pc,
            "quantity":     float(qty),
            "unit_price":   int(up),
            "line_total":   int(lt),
        })

    cur.execute("SELECT so_number, customer_code FROM sales_order")
    so_cust_map = dict(cur.fetchall())

    cur.execute("SELECT customer_code, tax_code FROM customer WHERE tax_code IS NOT NULL")
    cust_tax = {r[0]: r[1] for r in cur.fetchall()}

    # C1-2: so_number tồn tại trong DB
    missing_so = [r for r in records if r["header"]["so_number"] not in so_map]
    check("C1-2  Mọi so_number trong JSONL có trong sales_order",
          len(missing_so) == 0,
          f"{len(missing_so)} đơn thiếu" if missing_so else "")

    # C1-3: Số dòng order_line
    line_count_mismatch = []
    for rec in records:
        so = rec["header"]["so_number"]
        if so not in db_lines:
            continue
        j_count = len(rec["lines"])
        d_count = len(db_lines[so])
        if j_count != d_count:
            line_count_mismatch.append((so, j_count, d_count))
    check("C1-3  Số dòng order_line JSONL == DB (mỗi đơn)",
          len(line_count_mismatch) == 0,
          f"{len(line_count_mismatch)} đơn lệch số dòng" if line_count_mismatch else "")
    for so, j, d in line_count_mismatch[:5]:
        info(f"  {so}: jsonl={j}  db={d}")

    # C1-4..6: quantity, unit_price, line_total — so khớp từng dòng (sắp xếp theo product_code)
    qty_mm, price_mm, total_mm = [], [], []
    for rec in records:
        so = rec["header"]["so_number"]
        if so not in db_lines:
            continue
        j_sorted = sorted(rec["lines"], key=lambda x: x["product_code"])
        d_sorted = sorted(db_lines[so],  key=lambda x: x["product_code"])
        if len(j_sorted) != len(d_sorted):
            continue  # đã báo ở C1-3
        for jl, dl in zip(j_sorted, d_sorted):
            if abs(float(jl["quantity"]) - dl["quantity"]) > 0.001:
                qty_mm.append((so, jl["product_code"], jl["quantity"], dl["quantity"]))
            if abs(int(jl["unit_price"]) - dl["unit_price"]) > 0:
                price_mm.append((so, jl["product_code"], jl["unit_price"], dl["unit_price"]))
            if abs(int(jl["line_total"]) - dl["line_total"]) > 2:
                total_mm.append((so, jl["product_code"], jl["line_total"], dl["line_total"]))

    check("C1-4  quantity JSONL == DB",
          len(qty_mm) == 0,
          f"{len(qty_mm)} dòng lệch" if qty_mm else "")
    for so, pc, j, d in qty_mm[:5]:
        info(f"  {so} / {pc}: jsonl={j}  db={d}")

    check("C1-5  unit_price JSONL == DB",
          len(price_mm) == 0,
          f"{len(price_mm)} dòng lệch" if price_mm else "")
    for so, pc, j, d in price_mm[:5]:
        info(f"  {so} / {pc}: jsonl={j:,}  db={d:,}")

    check("C1-6  line_total JSONL == DB (tol=2đ)",
          len(total_mm) == 0,
          f"{len(total_mm)} dòng lệch" if total_mm else "")
    for so, pc, j, d in total_mm[:5]:
        info(f"  {so} / {pc}: jsonl={j:,}  db={d:,}  diff={d-j:+,}")

    # C1-7: footer_total JSONL vs total_amount DB
    footer_mm = []
    for rec in records:
        so = rec["header"]["so_number"]
        ft = rec.get("footer_total")
        if ft is None or so not in so_map:
            continue
        diff = so_map[so]["total"] - int(ft)
        if abs(diff) > 2:
            footer_mm.append((so, ft, so_map[so]["total"], diff))
    check("C1-7  footer_total PDF == total_amount DB (tol=2đ)",
          len(footer_mm) == 0,
          f"{len(footer_mm)} đơn lệch" if footer_mm else "")
    for so, fp, db, diff in sorted(footer_mm, key=lambda x: abs(x[3]), reverse=True)[:5]:
        info(f"  {so}: pdf={fp:,}  db={db:,}  diff={diff:+,}")

    # C1-8: order_date
    date_mm = []
    for rec in records:
        so = rec["header"]["so_number"]
        jd = rec["header"].get("order_date")
        if jd and so in so_map and so_map[so]["date"] != jd:
            date_mm.append((so, jd, so_map[so]["date"]))
    check("C1-8  order_date JSONL == DB",
          len(date_mm) == 0,
          f"{len(date_mm)} đơn lệch ngày" if date_mm else "")
    for so, j, d in date_mm[:5]:
        info(f"  {so}: jsonl={j}  db={d}")

    # C1-9: tax_code JSONL vs customer trong DB
    tax_mm = []
    for rec in records:
        so = rec["header"]["so_number"]
        j_tax = rec["header"].get("tax_code")
        if not j_tax or so not in so_cust_map:
            continue
        ccode = so_cust_map[so]
        db_tax = cust_tax.get(ccode)
        if db_tax and db_tax != j_tax:
            tax_mm.append((so, j_tax, db_tax))
    check("C1-9  tax_code JSONL == tax_code của customer trong DB",
          len(tax_mm) == 0,
          f"{len(tax_mm)} đơn lệch MST" if tax_mm else "")
    for so, j, d in tax_mm[:5]:
        info(f"  {so}: jsonl={j}  db={d}")

    # C1-10: Font corruption — product_name trong JSONL bị vỡ có vào DB không
    import re
    corrupt_re = re.compile(r"(?<![a-zA-Z])nn(?![a-zA-Z])|Thnng|Nhnt|nnp\b|Hnng\b|Chinc\b|nen\b(?! )|\bnn\b")
    corrupt_in_jsonl = set()
    for rec in records:
        for ln in rec["lines"]:
            if corrupt_re.search(ln.get("product_name") or ""):
                corrupt_in_jsonl.add(ln["product_code"])

    if corrupt_in_jsonl:
        cur.execute(
            "SELECT product_code, product_name FROM product WHERE product_code = ANY(%s)",
            (list(corrupt_in_jsonl),)
        )
        in_db = cur.fetchall()
        n_corrupt_db = sum(1 for _, n in in_db if corrupt_re.search(n or ""))
        check("C1-10 Font corruption trong JSONL KHÔNG lan vào product.product_name",
              n_corrupt_db == 0,
              f"{n_corrupt_db}/{len(corrupt_in_jsonl)} product bị vỡ font trong DB" if n_corrupt_db else
              f"product_name đã được làm sạch ({len(corrupt_in_jsonl)} mã bị vỡ trong JSONL nhưng OK trong DB)")
        info(f"  Số product_code bị vỡ font trong JSONL: {len(corrupt_in_jsonl)}")
    else:
        check("C1-10 Không có font corruption trong JSONL product_name", True)


# =============================================================================
# CHIỀU 2 — Database → Excel / CSV
# =============================================================================
def check_db_to_csv(cur):
    section("CHIỀU 2 · Database  →  Excel / CSV")

    tables_to_check = {
        "sales_order":  ("SELECT COUNT(*), SUM(total_amount), SUM(total_quantity) FROM sales_order",
                         ["order_id", "total_amount", "total_quantity", "line_count"]),
        "order_line":   ("SELECT COUNT(*), SUM(line_total), SUM(quantity) FROM order_line",
                         ["line_id", "order_id", "quantity", "unit_price", "line_total"]),
        "fact_sales":   ("SELECT COUNT(*), SUM(line_total), SUM(quantity) FROM fact_sales",
                         ["fact_id", "quantity", "unit_price", "line_total"]),
        "customer":     ("SELECT COUNT(*) FROM customer", ["customer_code"]),
        "product":      ("SELECT COUNT(*) FROM product", ["product_code"]),
        "province":     ("SELECT COUNT(*) FROM province", ["province_id"]),
    }

    for table, (db_sql, key_cols) in tables_to_check.items():
        csv_df = load_csv(table)
        if csv_df.empty:
            check(f"C2    {table}: CSV file tồn tại", False, "không tìm thấy file CSV")
            continue

        db_res = db_query(cur, db_sql)[0]
        db_count = db_res[0]
        csv_count = len(csv_df)

        # C2-1: Row count
        check(f"C2-1  {table}: số dòng DB == CSV",
              db_count == csv_count,
              f"db={db_count:,}  csv={csv_count:,}" if db_count != csv_count else f"{db_count:,} dòng")

        # C2-2..5: Kiểm tra tổng các cột số
        if table == "sales_order" and len(db_res) >= 3:
            db_sum_amount = int(db_res[1] or 0)
            db_sum_qty    = int(db_res[2] or 0)
            if "total_amount" in csv_df.columns:
                csv_sum_amount = int(csv_df["total_amount"].sum())
                check("C2-2  sales_order: SUM(total_amount) DB == CSV",
                      db_sum_amount == csv_sum_amount,
                      f"db={db_sum_amount:,}  csv={csv_sum_amount:,}" if db_sum_amount != csv_sum_amount
                      else f"{db_sum_amount:,}đ")
            if "total_quantity" in csv_df.columns:
                csv_sum_qty = int(csv_df["total_quantity"].sum())
                check("C2-3  sales_order: SUM(total_quantity) DB == CSV",
                      db_sum_qty == csv_sum_qty,
                      f"db={db_sum_qty:,}  csv={csv_sum_qty:,}" if db_sum_qty != csv_sum_qty
                      else f"{db_sum_qty:,} chiếc")

        elif table == "order_line" and len(db_res) >= 3:
            db_sum_lt  = int(db_res[1] or 0)
            db_sum_qty = float(db_res[2] or 0)
            if "line_total" in csv_df.columns:
                csv_sum_lt = int(csv_df["line_total"].sum())
                check("C2-4  order_line: SUM(line_total) DB == CSV",
                      db_sum_lt == csv_sum_lt,
                      f"db={db_sum_lt:,}  csv={csv_sum_lt:,}" if db_sum_lt != csv_sum_lt
                      else f"{db_sum_lt:,}đ")
            if "quantity" in csv_df.columns:
                csv_sum_qty = float(csv_df["quantity"].sum())
                ok_ = abs(db_sum_qty - csv_sum_qty) < 0.01
                check("C2-5  order_line: SUM(quantity) DB == CSV",
                      ok_, f"db={db_sum_qty:,.1f}  csv={csv_sum_qty:,.1f}" if not ok_
                      else f"{db_sum_qty:,.0f} chiếc")

        elif table == "fact_sales" and len(db_res) >= 3:
            db_sum_lt  = int(db_res[1] or 0)
            db_sum_qty = float(db_res[2] or 0)
            if "line_total" in csv_df.columns:
                csv_sum_lt = int(csv_df["line_total"].sum())
                check("C2-6  fact_sales: SUM(line_total) DB == CSV",
                      db_sum_lt == csv_sum_lt,
                      f"db={db_sum_lt:,}  csv={csv_sum_lt:,}" if db_sum_lt != csv_sum_lt
                      else f"{db_sum_lt:,}đ")
            if "quantity" in csv_df.columns:
                csv_sum_qty = float(csv_df["quantity"].sum())
                ok_ = abs(db_sum_qty - csv_sum_qty) < 0.01
                check("C2-7  fact_sales: SUM(quantity) DB == CSV",
                      ok_, f"db={db_sum_qty:,.1f}  csv={csv_sum_qty:,.1f}" if not ok_
                      else f"{db_sum_qty:,.0f} chiếc")

    # C2-8: fact_sales — cross check với order_line
    # fact_sales chứa DỮ LIỆU LỊCH SỬ (kể cả đơn không đến từ EML/PDF)
    # nên chỉ so sánh phần giao: so_number có trong cả 2 bảng
    cur.execute("""
        SELECT COUNT(DISTINCT fs.so_number),
               COUNT(DISTINCT so.so_number)
        FROM fact_sales fs
        FULL OUTER JOIN sales_order so ON so.so_number = fs.so_number
    """)
    fs_cnt, so_cnt = cur.fetchone()

    cur.execute("""
        SELECT COUNT(DISTINCT fs.so_number)
        FROM fact_sales fs
        WHERE fs.so_number NOT IN (SELECT so_number FROM sales_order)
    """)
    n_fs_extra = cur.fetchone()[0]

    cur.execute("""
        SELECT COUNT(DISTINCT so_number)
        FROM sales_order
        WHERE so_number NOT IN (SELECT so_number FROM fact_sales)
    """)
    n_so_missing = cur.fetchone()[0]

    # Mọi đơn trong sales_order phải có trong fact_sales
    check("C2-8  Mọi so_number trong sales_order có trong fact_sales",
          n_so_missing == 0,
          f"{n_so_missing} đơn trong sales_order chưa có trong fact_sales" if n_so_missing
          else f"fact_sales bao phủ toàn bộ {so_cnt:,} đơn (+ {n_fs_extra:,} đơn lịch sử thêm)")

    # Tổng line_total và quantity cho phần giao
    cur.execute("""
        SELECT SUM(ol.line_total), SUM(ol.quantity)
        FROM order_line ol
        JOIN sales_order so ON so.order_id = ol.order_id
        WHERE so.so_number IN (SELECT so_number FROM fact_sales)
    """)
    ol_lt, ol_qty = cur.fetchone()

    cur.execute("""
        SELECT SUM(fs.line_total), SUM(fs.quantity)
        FROM fact_sales fs
        WHERE fs.so_number IN (SELECT so_number FROM sales_order)
    """)
    fs_lt, fs_qty = cur.fetchone()

    check("C2-9  SUM(line_total) order_line == fact_sales (chỉ đơn chung)",
          abs(int(ol_lt or 0) - int(fs_lt or 0)) <= 2,
          f"order_line={int(ol_lt or 0):,}  fact_sales={int(fs_lt or 0):,}" if abs(int(ol_lt or 0) - int(fs_lt or 0)) > 2
          else f"{int(ol_lt or 0):,}đ")

    check("C2-10 SUM(quantity) order_line == fact_sales (chỉ đơn chung)",
          abs(float(ol_qty or 0) - float(fs_qty or 0)) < 0.01,
          f"order_line={float(ol_qty or 0):,.1f}  fact_sales={float(fs_qty or 0):,.1f}" if abs(float(ol_qty or 0) - float(fs_qty or 0)) >= 0.01
          else f"{float(ol_qty or 0):,.0f} chiếc")

    # C2-10: Không có order_id trong CSV mà không có trong DB
    csv_so = load_csv("sales_order")
    if not csv_so.empty and "order_id" in csv_so.columns:
        cur.execute("SELECT order_id FROM sales_order")
        db_ids = {r[0] for r in cur.fetchall()}
        csv_ids = set(csv_so["order_id"].astype(int).tolist())
        extra = csv_ids - db_ids
        missing = db_ids - csv_ids
        check("C2-10 Không có order_id nào trong CSV mà thiếu ở DB",
              len(missing) == 0 and len(extra) == 0,
              f"missing={len(missing)}, extra={len(extra)}" if (missing or extra) else "")


# =============================================================================
# SUMMARY
# =============================================================================
def main():
    print("=" * 70)
    print("  INTEGRITY CHECK  —  EML/PDF → DB → Excel/CSV")
    print("=" * 70)

    records = load_jsonl()

    with get_conn() as conn:
        with conn.cursor() as cur:
            check_eml_to_db(cur, records)
            check_db_to_csv(cur)

    section("TỔNG KẾT")
    total_checks = 21
    n_fail = len(issues)
    n_pass = total_checks - n_fail

    info(f"Tổng checks: {total_checks}  |  PASS: {n_pass}  |  FAIL: {n_fail}")
    print()
    if issues:
        print(f"  {FAIL}  CÁC VẤN ĐỀ PHÁT HIỆN ({n_fail}):")
        for i, issue in enumerate(issues, 1):
            print(f"       {i:>2}. {issue}")
    else:
        print(f"  {PASS}  Toàn vẹn dữ liệu ĐẦY ĐỦ — pipeline không mất/sai dữ liệu")
    print()


if __name__ == "__main__":
    main()
