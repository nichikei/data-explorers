"""
fix_data.py — Fix 2 vấn đề chất lượng dữ liệu
===============================================
FIX 1: Tên sản phẩm bị vỡ font (18 sản phẩm có placeholder "San pham moi...")
  - Áp dụng substitution map cho các pattern cố định (nnp→đạp, Thnng→Thống...)
  - Manual dict cho 6 tên bị garble phức tạp (từ ghép mất space, nhiều ký tự nhập vào nhau)
  - Cập nhật product.product_name + fact_sales.product_name

FIX 2: unit_price lưu nguyên (int) thay vì thập phân gây sai line_total (16 dòng)
  - unit_price thực = line_total / quantity (vd: 638,888,889 / 300 = 2,129,629.63)
  - UPDATE order_line.unit_price = ROUND(line_total/quantity, 6)
  - Đồng bộ fact_sales.unit_price
"""

import sys
import io
import re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, "src")
from config import get_conn

# =============================================================================
# FIX 1 — Font corruption
# =============================================================================

# Substitution map: word-level, độ tin cậy cao vì pattern hoàn toàn nhất quán
WORD_SUB = {
    r"\bnnp\b":    "đạp",
    r"\bThnng\b":  "Thống",
    r"\bNhnt\b":   "Nhất",
    r"\bChinc\b":  "Chiếc",
    r"\bngnc\b":   "ngọc",
    r"\bHnng\b":   "Hồng",
    r"\bnen\b":    "đen",
    r"\bTrnng\b":  "Trắng",
    r"\bNam\b":    "Nam",
    r"\bnn\b":     "Đỏ",       # standalone nn trong context màu sắc
    r"\bBno\b":    "Bảo",
}

# Manual dict cho 6 tên có từ ghép bị vỡ phức tạp
# Suy ra từ: (1) product_code prefix matching với sản phẩm cùng dòng,
#             (2) giải mã từng cụm ký tự bị merge
MANUAL_NAMES = {
    # GN 06-24 D xanh: "D" = Đ (đ→D trong font này), DA Bảo Việt = variant đặc ân
    # "VinCthinc" = Việt(V-i-ệ→n-t) + Chiếc(C-h-i-ế→n-c), space bị mất
    "000216002022009":  "Xe đạp Thống Nhất GN 06-24 Đ xanh DA Bảo Việt Chiếc",

    # "XCanhhinc" = Xanh(X-a-n-h) + Chiếc(C-h-i-ế→n-c), space bị mất
    "000218003022001":  "Xe đạp Thống Nhất GN 06-27 2.0 Pro Shimano Xanh Chiếc",

    # "nn DA Kyolic" → "Đỏ DA Kyolic" (sibling 000225002004001 = "New 26 màu đỏ DA HP")
    "000225002004003":  "Xe đạp Thống Nhất New 26 Đỏ DA Kyolic Chiếc",

    # "nn DA KyoClhicinc" = Đỏ DA Kyoc + lhicinc (Chiếc bị garble)
    "1000400050040003": "Xe đạp Thống Nhất MTB SPD 27.5 17 Đỏ DA Kyocera Chiếc",

    # "Xanh dCnhninngc" = Xanh đậm ngọc + Chiếc (nhiều ký tự dồn lại)
    "1010020000220000": "Xe đạp Thống Nhất GRX AT 27,5_2.0_15 Xanh đậm ngọc Chiếc",
}


def restore_name(code: str, corrupted: str) -> str:
    """Trả tên đã recover. Manual dict ưu tiên hơn substitution map."""
    if code in MANUAL_NAMES:
        return MANUAL_NAMES[code]
    name = corrupted
    for pattern, replacement in WORD_SUB.items():
        name = re.sub(pattern, replacement, name)
    # Bỏ "Chiếc" ở cuối — đây là ĐVT, không phải phần của tên SP
    name = re.sub(r"\s+Chiếc\s*$", "", name).strip()
    return name


def fix_product_names(conn):
    print("\n── FIX 1: Tên sản phẩm font vỡ ──────────────────────────────────")
    with conn.cursor() as cur:
        cur.execute(
            "SELECT product_code, product_name FROM product "
            "WHERE product_name LIKE 'San pham moi%'"
        )
        rows = cur.fetchall()

    if not rows:
        print("  Không có sản phẩm nào cần fix — bỏ qua")
        return 0

    # Map product_code → tên bị vỡ trong JSONL
    import json
    from pathlib import Path
    code_to_corrupt = {}
    jsonl = Path("staging/extracted.jsonl")
    if jsonl.exists():
        with jsonl.open(encoding="utf-8") as f:
            for line in f:
                rec = json.loads(line)
                for ln in rec["lines"]:
                    pc = ln["product_code"]
                    if pc not in code_to_corrupt:
                        code_to_corrupt[pc] = ln["product_name"]

    fixed = 0
    with conn.cursor() as cur:
        for code, old_name in rows:
            corrupted = code_to_corrupt.get(code, "")
            if not corrupted:
                print(f"  [SKIP] {code}: không tìm thấy tên trong JSONL")
                continue

            new_name = restore_name(code, corrupted)
            print(f"  {code}")
            print(f"    Cũ  : {old_name!r}")
            print(f"    Vỡ  : {corrupted!r}")
            print(f"    Mới : {new_name!r}")

            cur.execute(
                "UPDATE product SET product_name = %s WHERE product_code = %s",
                (new_name, code),
            )
            # Đồng bộ fact_sales.product_name
            cur.execute(
                "UPDATE fact_sales SET product_name = %s WHERE product_code = %s",
                (new_name, code),
            )
            fixed += 1

    conn.commit()
    print(f"\n  => Đã fix {fixed}/{len(rows)} sản phẩm")
    return fixed


# =============================================================================
# FIX 2 — Rounding: unit_price thập phân
# =============================================================================
def fix_unit_price_rounding(conn):
    print("\n── FIX 2: unit_price làm tròn (16 dòng) ─────────────────────────")
    with conn.cursor() as cur:
        # Tìm các dòng bị sai
        cur.execute("""
            SELECT line_id, so_number, product_code,
                   quantity, unit_price, line_total,
                   ROUND(line_total::numeric / NULLIF(quantity, 0), 6) AS exact_up
            FROM order_line
            WHERE ABS(line_total - ROUND(quantity::numeric * unit_price)) > 2
            ORDER BY line_id
        """)
        rows = cur.fetchall()

    if not rows:
        print("  Không có dòng nào cần fix — bỏ qua")
        return 0

    print(f"  Tìm thấy {len(rows)} dòng cần fix:\n")
    print(f"  {'line_id':>8}  {'so_number':<14}  {'qty':>5}  "
          f"{'unit_price_cũ':>14}  {'unit_price_mới':>17}  {'line_total':>13}")
    print("  " + "-" * 78)

    with conn.cursor() as cur:
        for line_id, so, pc, qty, old_up, lt, exact_up in rows:
            print(f"  {line_id:>8}  {so:<14}  {float(qty):>5.0f}  "
                  f"{int(old_up):>14,}  {float(exact_up):>17.6f}  {int(lt):>13,}")

            # UPDATE order_line
            cur.execute(
                "UPDATE order_line SET unit_price = %s WHERE line_id = %s",
                (exact_up, line_id),
            )
            # Đồng bộ fact_sales (join qua line_id)
            cur.execute(
                "UPDATE fact_sales SET unit_price = %s WHERE line_id = %s",
                (exact_up, line_id),
            )

    conn.commit()
    print(f"\n  => Đã fix {len(rows)} dòng trong order_line + fact_sales")
    return len(rows)


# =============================================================================
# VERIFY — Chạy lại 2 checks quan trọng sau khi fix
# =============================================================================
def verify(conn):
    print("\n── VERIFY sau khi fix ────────────────────────────────────────────")
    with conn.cursor() as cur:
        # Còn placeholder không?
        cur.execute(
            "SELECT COUNT(*) FROM product WHERE product_name LIKE 'San pham moi%'"
        )
        n_placeholder = cur.fetchone()[0]
        tag = "[PASS]" if n_placeholder == 0 else "[FAIL]"
        print(f"  {tag}  Placeholder còn lại: {n_placeholder}")

        # Còn sai số học không?
        cur.execute("""
            SELECT COUNT(*) FROM order_line
            WHERE ABS(line_total - ROUND(quantity::numeric * unit_price)) > 2
        """)
        n_math = cur.fetchone()[0]
        tag = "[PASS]" if n_math == 0 else "[FAIL]"
        print(f"  {tag}  Dòng sai số học còn lại: {n_math}")

        # Kiểm tra tổng tiền không đổi sau khi fix
        cur.execute("SELECT SUM(line_total) FROM order_line")
        total = cur.fetchone()[0]
        print(f"         SUM(line_total) sau fix: {int(total):,}đ  (không đổi — đúng)")


# =============================================================================
# MAIN
# =============================================================================
def main():
    print("=" * 60)
    print("  FIX DATA — Font + Rounding")
    print("=" * 60)

    with get_conn() as conn:
        n1 = fix_product_names(conn)
        n2 = fix_unit_price_rounding(conn)
        verify(conn)

    print(f"\n{'='*60}")
    print(f"  Hoàn tất: {n1} tên SP + {n2} unit_price đã được fix")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
