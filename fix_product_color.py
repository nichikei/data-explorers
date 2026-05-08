"""
fix_product_color.py
====================
Điền color và line_id cho 18 sản phẩm mới (T3/2026) đang NULL.

Chiến lược:
  - color: trích từ tên sản phẩm đã recover + manual dict cho các trường hợp phức tạp
  - line_id: lấy từ sibling product (cùng 9 ký tự đầu product_code)
  - Đồng bộ fact_sales.color sau khi update
"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, "src")
from config import get_conn

# ── Color manual dict (suy từ tên + vị trí trong dòng sản phẩm) ──────────────
COLOR_MAP = {
    "000216002022009":  "Xanh DA Bảo Việt",   # GN 06-24 Đ xanh DA Bảo Việt
    "000218003022001":  "Xanh",                # GN 06-27 2.0 Pro Shimano Xanh
    "000219002001000":  "Đen",                 # GN 2.0 700C đen
    "000225002004003":  "Đỏ DA Kyolic",        # New 26 Đỏ DA Kyolic
    "000306002022000":  "Xanh",                # MTB 20-05 S xanh
    "1000400050040003": "Đỏ DA Kyocera",       # MTB SPD 27.5 17 Đỏ DA Kyocera
    "1010020000220000": "Xanh đậm ngọc",       # GRX AT 27,5_2.0_15 Xanh đậm ngọc
    "1010130010100000": "Xanh ngọc",           # REX Xanh ngọc
    # TP / 156 codes — không có thông tin màu trong tên
    "156.01.12.0003":   None,
    "TP0016.05.24.01":  None,
    "TP0017.06.27.04":  None,
    "TP0022.02.16.00":  None,
    "TP0022.03.16.00":  None,
    "TP0023.02.25.00":  None,
    "TP0099.0000567":   None,
    "TP0099.0000568":   None,
    "TP0099.0000570":   None,
    "TP0099.0000571":   None,
}


def fix_color_and_line(conn):
    with conn.cursor() as cur:
        # Lấy danh sách sản phẩm cần fix
        cur.execute("""
            SELECT product_code, product_name
            FROM product
            WHERE color IS NULL
              AND product_name LIKE 'Xe đạp Thống Nhất%'
              AND product_code = ANY(%s)
        """, (list(COLOR_MAP.keys()),))
        targets = cur.fetchall()

        # Tìm line_id từ sibling (cùng 9 ký tự đầu, có line_id)
        cur.execute("""
            SELECT LEFT(product_code,9) AS prefix, MIN(line_id) AS line_id
            FROM product
            WHERE line_id IS NOT NULL
            GROUP BY LEFT(product_code,9)
        """)
        prefix_to_line = {row[0]: row[1] for row in cur.fetchall()}

    print(f"{'product_code':<22} {'color_mới':<22} {'line_id_mới':<12} product_name")
    print("─" * 95)

    updated = 0
    with conn.cursor() as cur:
        for code, name in targets:
            color   = COLOR_MAP.get(code)
            line_id = prefix_to_line.get(code[:9])

            print(f"  {code:<20} {str(color):<22} {str(line_id):<12} {name}")

            cur.execute("""
                UPDATE product
                SET color   = COALESCE(%s, color),
                    line_id = COALESCE(%s, line_id)
                WHERE product_code = %s
            """, (color, line_id, code))

            # Đồng bộ fact_sales
            if color:
                cur.execute("""
                    UPDATE fact_sales SET color = %s
                    WHERE product_code = %s AND (color IS NULL OR color = '')
                """, (color, code))

    conn.commit()
    print(f"\n  => Đã update {len(targets)} sản phẩm")

    # ── Verify ────────────────────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*) FROM product
            WHERE color IS NULL
              AND product_name LIKE 'Xe đạp Thống Nhất%'
              AND product_code = ANY(%s)
        """, (list(COLOR_MAP.keys()),))
        still_null = cur.fetchone()[0]

        cur.execute("""
            SELECT product_code, product_name, color, line_id
            FROM product
            WHERE product_code = ANY(%s)
            ORDER BY product_code
        """, (list(COLOR_MAP.keys()),))
        final = cur.fetchall()

    print(f"\n{'─'*75}")
    print(f"  Kết quả sau fix:")
    print(f"  {'product_code':<22} {'color':<22} {'line_id':<10} product_name")
    print(f"  {'─'*73}")
    for code, name, color, lid in final:
        c_tag = str(color) if color else "(NULL)"
        l_tag = str(lid)   if lid   else "(NULL)"
        print(f"  {code:<22} {c_tag:<22} {l_tag:<10} {name}")

    tag = "[PASS]" if still_null == 0 else f"[WARN] còn {still_null} NULL"
    print(f"\n  {tag}  color đã điền: {len(targets) - still_null}/{len(targets)}")


def main():
    print("=" * 60)
    print("  FIX product.color + product.line_id")
    print("=" * 60)
    with get_conn() as conn:
        fix_color_and_line(conn)
    print()


if __name__ == "__main__":
    main()
