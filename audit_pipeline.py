"""
audit_pipeline.py
=================
Kiểm tra toàn diện dữ liệu đã parse từ EML/PDF vào database.

Các mục kiểm tra:
  A1. Tổng quan email_log — số đơn theo từng trạng thái
  A2. Font corruption trong tên SP và tên khách hàng (DB)
  A3. Kiểm tra tính đúng đắn số học: quantity × unit_price == line_total
  A4. Tổng order_line.line_total == sales_order.total_amount
  A5. Footer total (extracted.jsonl) vs tổng thực tế trong DB
  A6. Số đơn EML vs DB — đơn nào bị thiếu
  A7. Đơn FAILED và lý do
  A8. Khách hàng mới tạo (KH-XXXXX) — kiểm tra tên có bị vỡ font không
  A9. product_code trong order_line có tồn tại trong product không
  A10. Kiểm tra null bất thường trong các trường quan trọng
"""

import sys
import io
import json
import re
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).parent / "src"))
from config import get_conn, EXTRACTED_JSONL

# Ký tự thay thế khi font bị vỡ — thường là 'n' hoặc ký tự lạ thay cho dấu tiếng Việt
# "nâu" (brown) là màu hợp lệ — KHÔNG đưa vào đây
FONT_CORRUPT_RE = re.compile(r"\bnn\b|Thnn|Nhnn|\bnnp\b|Thnng|Nhnt|\bHnng\b|\bChinc\b|Xanh\s*dnn|\bnen\b")

DIVIDER = "-" * 70


def section(title: str):
    print(f"\n{'=' * 70}")
    print(f"  {title}")
    print('=' * 70)


def ok(msg):   print(f"  [OK]   {msg}")
def warn(msg): print(f"  [WARN] {msg}")
def err(msg):  print(f"  [ERR]  {msg}")
def info(msg): print(f"         {msg}")


# =============================================================================
# A1 — Tổng quan email_log
# =============================================================================
def check_email_log(cur):
    section("A1 · Tổng quan email_log")
    cur.execute("""
        SELECT processing_status, COUNT(*) AS cnt
        FROM email_log
        GROUP BY processing_status
        ORDER BY cnt DESC
    """)
    rows = cur.fetchall()
    total = sum(r[1] for r in rows)
    for status, cnt in rows:
        pct = cnt / total * 100 if total else 0
        print(f"  {status:<15} {cnt:>6,}  ({pct:.1f}%)")
    print(f"  {'TONG':<15} {total:>6,}")

    cur.execute("SELECT COUNT(*) FROM email_log WHERE processing_status='FAILED'")
    n_fail = cur.fetchone()[0]
    if n_fail:
        warn(f"{n_fail} đơn FAILED — xem chi tiết ở A7")
    else:
        ok("Không có đơn FAILED")
    return total


# =============================================================================
# A2 — Font corruption trong DB
# =============================================================================
def check_font_corruption(cur):
    section("A2 · Font corruption trong dữ liệu DB")

    # Tên sản phẩm trong order_line (qua product)
    cur.execute("SELECT product_code, product_name FROM product WHERE product_name IS NOT NULL")
    products = cur.fetchall()
    corrupt_prod = [(c, n) for c, n in products if FONT_CORRUPT_RE.search(n or "")]
    if corrupt_prod:
        err(f"{len(corrupt_prod)} sản phẩm có tên bị vỡ font (mẫu: 'nn', 'Thnng', 'nnp'):")
        for code, name in corrupt_prod[:10]:
            info(f"  {code}: {name!r}")
        if len(corrupt_prod) > 10:
            info(f"  ... và {len(corrupt_prod) - 10} sản phẩm khác")
    else:
        ok("Tên sản phẩm trong DB không có dấu hiệu vỡ font")

    # Tên khách hàng
    cur.execute("SELECT customer_code, customer_name FROM customer WHERE customer_name IS NOT NULL")
    customers = cur.fetchall()
    corrupt_cust = [(c, n) for c, n in customers if FONT_CORRUPT_RE.search(n or "")]
    if corrupt_cust:
        err(f"{len(corrupt_cust)} khách hàng có tên bị vỡ font:")
        for code, name in corrupt_cust[:10]:
            info(f"  {code}: {name!r}")
        if len(corrupt_cust) > 10:
            info(f"  ... và {len(corrupt_cust) - 10} khách hàng khác")
    else:
        ok("Tên khách hàng trong DB không có dấu hiệu vỡ font")

    return len(corrupt_prod), len(corrupt_cust)


# =============================================================================
# A3 — Kiểm tra số học order_line: qty × unit_price == line_total
# =============================================================================
def check_line_math(cur):
    section("A3 · Số học order_line: quantity × unit_price vs line_total")
    cur.execute("""
        SELECT line_id, so_number, product_code, quantity, unit_price, line_total,
               ROUND(quantity::numeric * unit_price) AS expected
        FROM order_line
        WHERE ABS(line_total - ROUND(quantity::numeric * unit_price)) > 2
        LIMIT 50
    """)
    rows = cur.fetchall()
    if not rows:
        ok("Tất cả dòng order_line: line_total khớp với qty × unit_price (tol=2đ)")
    else:
        err(f"{len(rows)} dòng có line_total KHÔNG khớp qty × unit_price:")
        print(f"  {'line_id':>8} {'so_number':<14} {'product_code':<18} "
              f"{'qty':>5} {'unit_price':>12} {'line_total':>12} {'expected':>12} {'diff':>8}")
        print(f"  {DIVIDER}")
        for r in rows:
            lid, so, pc, qty, up, lt, exp = r
            diff = lt - int(exp)
            print(f"  {lid:>8} {so:<14} {pc:<18} {float(qty):>5.1f} "
                  f"{up:>12,} {lt:>12,} {int(exp):>12,} {diff:>+8,}")
    return len(rows)


# =============================================================================
# A4 — Tổng order_line vs sales_order.total_amount
# =============================================================================
def check_order_totals(cur):
    section("A4 · Tổng order_line vs sales_order.total_amount")
    cur.execute("""
        SELECT s.order_id, s.so_number, s.total_amount,
               COALESCE(SUM(ol.line_total), 0) AS sum_lines,
               ABS(s.total_amount - COALESCE(SUM(ol.line_total), 0)) AS diff
        FROM sales_order s
        LEFT JOIN order_line ol ON ol.order_id = s.order_id
        GROUP BY s.order_id, s.so_number, s.total_amount
        HAVING ABS(s.total_amount - COALESCE(SUM(ol.line_total), 0)) > 2
        ORDER BY diff DESC
        LIMIT 20
    """)
    rows = cur.fetchall()
    if not rows:
        ok("Tất cả sales_order: total_amount khớp với SUM(order_line.line_total)")
    else:
        err(f"{len(rows)} đơn có total_amount KHÔNG khớp tổng order_line:")
        print(f"  {'order_id':>9} {'so_number':<14} {'total_amount':>14} {'sum_lines':>14} {'diff':>10}")
        print(f"  {DIVIDER}")
        for oid, so, ta, sl, diff in rows:
            print(f"  {oid:>9} {so:<14} {ta:>14,} {sl:>14,} {diff:>+10,}")
    return len(rows)


# =============================================================================
# A5 — Footer total (JSONL) vs tổng thực tế trong DB
# =============================================================================
def check_footer_vs_db(cur):
    section("A5 · Footer total từ PDF vs tổng thực tế trong DB")
    if not EXTRACTED_JSONL.exists():
        warn("Không tìm thấy extracted.jsonl — bỏ qua A5")
        return 0

    # Build map so_number → footer_total từ JSONL
    footer_map: dict[str, int] = {}
    with EXTRACTED_JSONL.open(encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            so = (rec.get("header") or {}).get("so_number")
            ft = rec.get("footer_total")
            if so and ft is not None:
                footer_map[so] = int(ft)

    if not footer_map:
        warn("JSONL không có dữ liệu footer_total")
        return 0

    cur.execute("""
        SELECT so_number, total_amount
        FROM sales_order
        WHERE so_number = ANY(%s)
    """, (list(footer_map.keys()),))
    db_map = {r[0]: r[1] for r in cur.fetchall()}

    mismatches = []
    for so, footer in footer_map.items():
        db_total = db_map.get(so)
        if db_total is None:
            continue  # đơn chưa load vào DB — đã báo ở A6
        if abs(int(db_total) - footer) > 2:
            mismatches.append((so, footer, int(db_total), int(db_total) - footer))

    if not mismatches:
        ok(f"Tất cả {len(db_map)} đơn: footer_total từ PDF khớp total_amount trong DB")
    else:
        warn(f"{len(mismatches)} đơn có footer PDF ≠ total_amount DB (có thể parse sai):")
        print(f"  {'so_number':<14} {'footer_pdf':>14} {'db_total':>14} {'diff':>10}")
        print(f"  {DIVIDER}")
        for so, fp, dt, diff in sorted(mismatches, key=lambda x: abs(x[3]), reverse=True)[:20]:
            print(f"  {so:<14} {fp:>14,} {dt:>14,} {diff:>+10,}")
    return len(mismatches)


# =============================================================================
# A6 — Đơn trong EML vs đơn trong DB
# =============================================================================
def check_coverage(cur):
    section("A6 · Coverage: EML → DB")
    cur.execute("SELECT COUNT(*) FROM email_log")
    total_eml = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM email_log WHERE processing_status='LOADED'")
    loaded = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM sales_order")
    n_so = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM order_line")
    n_ol = cur.fetchone()[0]

    info(f"email_log tổng:      {total_eml:>6,}")
    info(f"Trạng thái LOADED:   {loaded:>6,}  ({loaded/total_eml*100:.1f}%)" if total_eml else "")
    info(f"sales_order:         {n_so:>6,}")
    info(f"order_line:          {n_ol:>6,}")

    # Đơn trong email_log nhưng chưa vào sales_order
    cur.execute("""
        SELECT el.so_number, el.processing_status, el.error_stage, el.error_message
        FROM email_log el
        WHERE el.processing_status != 'LOADED'
          AND el.so_number IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM sales_order so WHERE so.so_number = el.so_number
          )
        ORDER BY el.so_number
        LIMIT 30
    """)
    missing = cur.fetchall()
    if missing:
        warn(f"{len(missing)} đơn (có so_number) chưa vào sales_order:")
        print(f"  {'so_number':<14} {'status':<12} {'stage':<12} {'reason'}")
        print(f"  {DIVIDER}")
        for so, st, stage, msg in missing:
            reason = (msg or "")[:60]
            print(f"  {so or '?':<14} {st:<12} {stage or '':<12} {reason}")
    else:
        ok("Tất cả đơn có so_number đều đã được load vào sales_order")

    return len(missing)


# =============================================================================
# A7 — FAILED orders — lý do
# =============================================================================
def check_failed(cur):
    section("A7 · Đơn FAILED — phân tích lý do")
    cur.execute("""
        SELECT error_stage,
               LEFT(error_message, 80) AS reason,
               COUNT(*) AS cnt
        FROM email_log
        WHERE processing_status = 'FAILED'
        GROUP BY error_stage, LEFT(error_message, 80)
        ORDER BY cnt DESC
        LIMIT 20
    """)
    rows = cur.fetchall()
    if not rows:
        ok("Không có đơn FAILED")
        return 0

    total_fail = sum(r[2] for r in rows)
    err(f"Tổng {total_fail} đơn FAILED, phân nhóm theo lý do:")
    print(f"  {'Stage':<12} {'Số đơn':>8}  Lý do")
    print(f"  {DIVIDER}")
    for stage, reason, cnt in rows:
        print(f"  {stage or '?':<12} {cnt:>8}  {reason or '(null)'}")
    return total_fail


# =============================================================================
# A8 — Khách hàng mới tạo (KH-XXXXX)
# =============================================================================
def check_new_customers(cur):
    section("A8 · Khách hàng mới tạo bởi pipeline (KH-XXXXX)")
    cur.execute("""
        SELECT customer_code, customer_name, tax_code
        FROM customer
        WHERE customer_code ~ '^KH-\d+$'
        ORDER BY customer_code
    """)
    rows = cur.fetchall()
    if not rows:
        ok("Không có khách hàng mới nào được tạo bởi pipeline")
        return 0, 0

    info(f"Tổng {len(rows)} khách hàng mới (KH-XXXXX):")
    corrupt = [(c, n, t) for c, n, t in rows if FONT_CORRUPT_RE.search(n or "")]
    good    = len(rows) - len(corrupt)

    ok(f"  Tên sạch (OK):       {good}")
    if corrupt:
        err(f"  Tên vỡ font (ERR):   {len(corrupt)}")
        print(f"\n  {'code':<12} {'tax_code':<14} {'customer_name'}")
        print(f"  {DIVIDER}")
        for code, name, tax in corrupt[:20]:
            print(f"  {code:<12} {tax or '':<14} {name!r}")
        if len(corrupt) > 20:
            info(f"  ... và {len(corrupt)-20} khách khác")
    return len(rows), len(corrupt)


# =============================================================================
# A9 — product_code orphan
# =============================================================================
def check_orphan_products(cur):
    section("A9 · order_line.product_code có trong bảng product không?")
    cur.execute("""
        SELECT DISTINCT ol.product_code
        FROM order_line ol
        WHERE NOT EXISTS (
            SELECT 1 FROM product p WHERE p.product_code = ol.product_code
        )
    """)
    orphans = [r[0] for r in cur.fetchall()]
    if not orphans:
        ok("Tất cả product_code trong order_line đều có trong bảng product")
    else:
        err(f"{len(orphans)} product_code trong order_line KHÔNG có trong product:")
        for pc in orphans[:20]:
            info(f"  {pc}")
    return len(orphans)


# =============================================================================
# A10 — Null quan trọng
# =============================================================================
def check_nulls(cur):
    section("A10 · Kiểm tra giá trị NULL trong các trường quan trọng")
    checks = [
        ("sales_order",  "order_date IS NULL",          "order_date"),
        ("sales_order",  "customer_code IS NULL",        "customer_code"),
        ("sales_order",  "total_amount IS NULL",         "total_amount"),
        ("order_line",   "product_code IS NULL",         "product_code"),
        ("order_line",   "quantity IS NULL OR quantity <= 0", "quantity ≤ 0"),
        ("order_line",   "unit_price IS NULL OR unit_price < 0", "unit_price < 0"),
        ("order_line",   "line_total IS NULL",           "line_total"),
        ("customer",     "customer_name IS NULL OR customer_name = ''", "customer_name rỗng"),
        ("email_log",    "so_number IS NULL",            "so_number"),
    ]
    any_issue = False
    for table, condition, label in checks:
        cur.execute(f"SELECT COUNT(*) FROM {table} WHERE {condition}")
        cnt = cur.fetchone()[0]
        if cnt:
            err(f"{table}.{label}: {cnt:,} dòng")
            any_issue = True
        else:
            ok(f"{table}.{label}: 0 dòng")
    if not any_issue:
        ok("Không có NULL bất thường")


# =============================================================================
# MAIN
# =============================================================================
def main():
    print("=" * 70)
    print("  AUDIT PIPELINE — Kiểm tra dữ liệu EML/PDF → Database")
    print("=" * 70)

    with get_conn() as conn:
        with conn.cursor() as cur:
            check_email_log(cur)
            n_cp, n_cc = check_font_corruption(cur)
            n_math  = check_line_math(cur)
            n_total = check_order_totals(cur)
            n_foot  = check_footer_vs_db(cur)
            n_miss  = check_coverage(cur)
            n_fail  = check_failed(cur)
            n_new, n_nc = check_new_customers(cur)
            n_orp   = check_orphan_products(cur)
            check_nulls(cur)

    # ---------- Tổng kết ----------
    section("TỔNG KẾT")
    issues = []
    if n_cp:    issues.append(f"Font vỡ tên SP: {n_cp}")
    if n_cc:    issues.append(f"Font vỡ tên KH: {n_cc}")
    if n_math:  issues.append(f"Sai số học line: {n_math}")
    if n_total: issues.append(f"Sai total_amount: {n_total}")
    if n_foot:  issues.append(f"Footer mismatch: {n_foot}")
    if n_miss:  issues.append(f"Đơn chưa load: {n_miss}")
    if n_fail:  issues.append(f"Đơn FAILED: {n_fail}")
    if n_nc:    issues.append(f"KH mới tên vỡ: {n_nc}")
    if n_orp:   issues.append(f"Orphan product_code: {n_orp}")

    if issues:
        print()
        err("CÁC VẤN ĐỀ CẦN XỬ LÝ:")
        for i in issues:
            print(f"  • {i}")
    else:
        ok("Dữ liệu sạch — không phát hiện vấn đề")

    print()


if __name__ == "__main__":
    main()
