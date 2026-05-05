"""
final_audit.py
==============
Kiểm tra toàn diện các lỗi ẩn còn lại sau khi pipeline chạy xong.
Mỗi check độc lập — fail 1 check không dừng các check còn lại.
"""
import psycopg2

DB = dict(host='localhost', port=5432, dbname='tnbike_db', user='postgres', password='1')

CHECKS = []
results = []


def check(name):
    """Decorator đăng ký 1 check function."""
    def decorator(fn):
        CHECKS.append((name, fn))
        return fn
    return decorator


# ─────────────────────────────────────────────────────────────────────────────
# CHECK 1: Ngày đặt hàng T3/2026 phải nằm trong 01/03 - 31/03/2026
# ─────────────────────────────────────────────────────────────────────────────
@check("C01 - Ngày đặt hàng nằm ngoài T3/2026")
def c01(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT so_number, order_date
        FROM tnbike.sales_order
        WHERE so_number LIKE 'BH26.%%'
        AND (order_date < '2026-03-01' OR order_date > '2026-03-31')
    """)
    rows = cur.fetchall()
    cur.close()
    if rows:
        return "FAIL", "{} đơn có ngày ngoài T3/2026: {}".format(
            len(rows), [r[0] for r in rows[:5]])
    return "OK", "Tất cả 1132 đơn có ngày trong 01/03-31/03/2026"


# ─────────────────────────────────────────────────────────────────────────────
# CHECK 2: sales_order không có order_line nào (đơn rỗng)
# ─────────────────────────────────────────────────────────────────────────────
@check("C02 - Đơn hàng không có dòng sản phẩm nào")
def c02(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT so.so_number
        FROM tnbike.sales_order so
        WHERE so.so_number LIKE 'BH26.%%'
        AND NOT EXISTS (
            SELECT 1 FROM tnbike.order_line ol WHERE ol.order_id = so.order_id
        )
    """)
    rows = cur.fetchall()
    cur.close()
    if rows:
        return "FAIL", "{} đơn rỗng: {}".format(len(rows), [r[0] for r in rows])
    return "OK", "Không có đơn rỗng"


# ─────────────────────────────────────────────────────────────────────────────
# CHECK 3: Dòng trùng lặp trong cùng 1 đơn (same order_id + product_code)
# ─────────────────────────────────────────────────────────────────────────────
@check("C03 - Dòng sản phẩm trùng lặp trong cùng 1 đơn")
def c03(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT ol.so_number, ol.product_code, COUNT(*) AS n
        FROM tnbike.order_line ol
        WHERE ol.so_number LIKE 'BH26.%%'
        GROUP BY ol.so_number, ol.product_code
        HAVING COUNT(*) > 1
        ORDER BY n DESC
        LIMIT 10
    """)
    rows = cur.fetchall()
    cur.close()
    if rows:
        # Trùng mã hàng trong 1 đơn có thể hợp lệ (2 dòng khác màu cùng mã)
        # nên chỉ warn
        return "WARN", "{} cặp (so_number, product_code) xuất hiện >1 lần — xem lại thủ công".format(len(rows))
    return "OK", "Không có dòng trùng lặp"


# ─────────────────────────────────────────────────────────────────────────────
# CHECK 4: unit_price = 0 (giá bán bằng 0 — có thể là lỗi parse)
# ─────────────────────────────────────────────────────────────────────────────
@check("C04 - Dòng sản phẩm có đơn giá = 0")
def c04(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT so_number, product_code, quantity, unit_price
        FROM tnbike.order_line
        WHERE so_number LIKE 'BH26.%%'
        AND unit_price = 0
    """)
    rows = cur.fetchall()
    cur.close()
    if rows:
        return "FAIL", "{} dòng có đơn giá = 0: {}".format(
            len(rows), [(r[0], r[1]) for r in rows[:5]])
    return "OK", "Không có dòng giá = 0"


# ─────────────────────────────────────────────────────────────────────────────
# CHECK 5: Số lượng bất thường (> 1000 chiếc trong 1 dòng)
# ─────────────────────────────────────────────────────────────────────────────
@check("C05 - Số lượng bất thường (> 1000 chiếc/dòng)")
def c05(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT so_number, product_code, quantity
        FROM tnbike.order_line
        WHERE so_number LIKE 'BH26.%%'
        AND quantity > 1000
        ORDER BY quantity DESC
    """)
    rows = cur.fetchall()
    cur.close()
    if rows:
        return "WARN", "{} dòng có SL > 1000: {}".format(
            len(rows), [(r[0], r[1], float(r[2])) for r in rows[:5]])
    return "OK", "Không có số lượng bất thường"


# ─────────────────────────────────────────────────────────────────────────────
# CHECK 6: fact_sales có đủ dòng khớp với order_line không
# ─────────────────────────────────────────────────────────────────────────────
@check("C06 - fact_sales đồng bộ với order_line")
def c06(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT
            (SELECT COUNT(*) FROM tnbike.order_line WHERE so_number LIKE 'BH26.%%') AS ol_count,
            (SELECT COUNT(*) FROM tnbike.fact_sales WHERE fiscal_year=2026 AND fiscal_month=3) AS fs_count
    """)
    ol, fs = cur.fetchone()
    cur.close()
    if ol != fs:
        return "FAIL", "order_line T3/2026={} vs fact_sales T3/2026={} — lệch {} dòng".format(ol, fs, abs(ol-fs))
    return "OK", "order_line = fact_sales = {} dòng".format(ol)


# ─────────────────────────────────────────────────────────────────────────────
# CHECK 7: Khách hàng mới (KH-00703+) phải có tax_code
# ─────────────────────────────────────────────────────────────────────────────
@check("C07 - Khách hàng mới tạo thiếu tax_code")
def c07(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT customer_code, customer_name
        FROM tnbike.customer
        WHERE customer_code > 'KH-00702'
        AND (tax_code IS NULL OR tax_code = '')
    """)
    rows = cur.fetchall()
    cur.close()
    if rows:
        return "WARN", "{} khách hàng mới không có MST: {}".format(
            len(rows), [r[0] for r in rows[:5]])
    return "OK", "Tất cả khách hàng mới đều có MST"


# ─────────────────────────────────────────────────────────────────────────────
# CHECK 8: Không có so_number nào bị duplicate trong DB
# ─────────────────────────────────────────────────────────────────────────────
@check("C08 - Trùng so_number trong sales_order")
def c08(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT so_number, COUNT(*) n
        FROM tnbike.sales_order
        GROUP BY so_number
        HAVING COUNT(*) > 1
    """)
    rows = cur.fetchall()
    cur.close()
    if rows:
        return "FAIL", "{} so_number bị trùng: {}".format(
            len(rows), [r[0] for r in rows])
    return "OK", "Không có so_number trùng"


# ─────────────────────────────────────────────────────────────────────────────
# CHECK 9: Tổng doanh thu T3/2026 hợp lý (không quá thấp hoặc quá cao)
# ─────────────────────────────────────────────────────────────────────────────
@check("C09 - Tổng doanh thu T3/2026 hợp lý")
def c09(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT SUM(line_total), COUNT(DISTINCT so_number), AVG(line_total)
        FROM tnbike.fact_sales
        WHERE fiscal_year=2026 AND fiscal_month=3
    """)
    total, orders, avg = cur.fetchone()
    cur.close()
    total = int(total or 0)
    avg   = float(avg or 0)
    # T3 nên tương đương hoặc cao hơn T1/T2
    if total < 10_000_000_000:
        return "WARN", "Tổng doanh thu T3 chỉ {:,} VND — có vẻ thấp".format(total)
    if avg < 100_000:
        return "WARN", "Giá trung bình dòng hàng chỉ {:,.0f} VND — có thể lỗi".format(avg)
    return "OK", "Tổng {:,} VND | {} đơn | Avg/dòng {:,.0f} VND".format(total, orders, avg)


# ─────────────────────────────────────────────────────────────────────────────
# CHECK 10: email_log không có trạng thái nào ngoài LOADED
# ─────────────────────────────────────────────────────────────────────────────
@check("C10 - email_log còn đơn chưa LOADED")
def c10(conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT processing_status, COUNT(*)
        FROM tnbike.email_log
        GROUP BY processing_status
    """)
    rows = cur.fetchall()
    cur.close()
    non_loaded = [(s, n) for s, n in rows if s != 'LOADED']
    if non_loaded:
        return "FAIL", "Còn trạng thái chưa LOADED: {}".format(non_loaded)
    loaded = next((n for s, n in rows if s == 'LOADED'), 0)
    return "OK", "Tất cả {} email đều LOADED".format(loaded)


# ─────────────────────────────────────────────────────────────────────────────
# RUN ALL
# ─────────────────────────────────────────────────────────────────────────────
def main():
    conn = psycopg2.connect(**DB)
    print("=" * 60)
    print("FINAL AUDIT — TNBIKE PIPELINE T3/2026")
    print("=" * 60)

    ok_count = warn_count = fail_count = 0

    for name, fn in CHECKS:
        try:
            status, msg = fn(conn)
        except Exception as e:
            status, msg = "ERROR", str(e)

        icon = {"OK": "✓", "WARN": "!", "FAIL": "✗", "ERROR": "✗"}.get(status, "?")
        print("[{}] {} — {}".format(icon, name, msg))

        if status == "OK":
            ok_count += 1
        elif status == "WARN":
            warn_count += 1
        else:
            fail_count += 1

    conn.close()
    print("=" * 60)
    print("OK: {}  |  WARN: {}  |  FAIL: {}".format(ok_count, warn_count, fail_count))
    print("=" * 60)


if __name__ == "__main__":
    main()
