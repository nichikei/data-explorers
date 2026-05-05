"""
deep_validate.py
================
Spot check ngẫu nhiên N đơn: so sánh nội dung PDF gốc vs dữ liệu trong DB.
Kiểm tra từng trường: so_number, order_date, tax_code, từng dòng hàng.
"""
import random
import re
import unicodedata
from pathlib import Path

import pdfplumber
import psycopg2

# ── config ────────────────────────────────────────────────────────────────────
DB = dict(host='localhost', port=5432, dbname='tnbike_db', user='postgres', password='1')
PDF_DIR   = Path('staging/pdf')
N_SAMPLE  = 1132
TOLERANCE = 200  # VND
# ─────────────────────────────────────────────────────────────────────────────

PRODUCT_CODE_RE = re.compile(
    r"^(?:\d{10,18}|[A-Z]{1,4}\d+(?:[.\-]\d+)+|\d{2,}\.\d{2}\.\d{2}\.\d{3,})$"
)


def nfc(s):
    return unicodedata.normalize("NFC", s) if s else s


def to_int(s):
    if not s:
        return 0
    try:
        return int(float(s.strip().replace(".", "").replace(",", "")))
    except Exception:
        return 0


def to_float(s):
    if not s:
        return 0.0
    try:
        cleaned = s.strip().replace(" ", "")
        if "," in cleaned and "." not in cleaned:
            cleaned = cleaned.replace(",", ".")
        elif "." in cleaned and "," in cleaned:
            cleaned = cleaned.replace(".", "").replace(",", ".")
        return float(cleaned)
    except Exception:
        return 0.0


def is_numeric_cell(s):
    if not s:
        return False
    cleaned = re.sub(r"[.,\s]", "", s.strip())
    return cleaned.isdigit() and len(cleaned) >= 1


def get_pdf_data(so_number):
    pdf_path = PDF_DIR / "{}.pdf".format(so_number.replace(".", "_"))
    if not pdf_path.exists():
        return {"error": "PDF not found: {}".format(pdf_path)}

    with pdfplumber.open(str(pdf_path)) as pdf:
        text   = "\n".join(p.extract_text() or "" for p in pdf.pages)
        tables = []
        for p in pdf.pages:
            tables.extend(p.extract_tables() or [])

    text = nfc(text)

    # so_number
    m  = re.search(r"BH\d{2}\.\d{4}", text)
    so = m.group(0) if m else None

    # order_date
    m = re.search(r"Ng[àa]y[:\s]+(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})", text, re.IGNORECASE)
    if m:
        d, mo, y = m.groups()
        order_date = "{}-{:02d}-{:02d}".format(y, int(mo), int(d))
    else:
        order_date = None

    # MST đại lý
    all_mst  = re.findall(r"MST[:\s]+(\d{9,13})", text, re.IGNORECASE)
    tax_code = next((x for x in all_mst if x != "0300397904"), None)

    # footer total
    m = re.search(
        r"T.{0,4}ng\s+gi.{0,3}\s*tr.{0,3}\s*.{0,5}n\s*h.{0,3}ng[:\s]+([\d.,]+)",
        text, re.IGNORECASE,
    )
    footer = None
    if m:
        try:
            footer = int(m.group(1).strip().replace(".", "").replace(",", ""))
        except Exception:
            pass

    # lines từ table
    lines = []
    for table in tables:
        for row in table:
            cells = [(c or "").strip() for c in row]

            code_idx = None
            for i, c in enumerate(cells):
                if PRODUCT_CODE_RE.match(c):
                    code_idx = i
                    break
            if code_idx is None:
                continue

            num_cols = [
                (i, c) for i, c in enumerate(cells)
                if i > code_idx
                and is_numeric_cell(c)
                and not PRODUCT_CODE_RE.match(c)
            ]
            if len(num_cols) < 3:
                continue

            qty_str, price_str, total_str = (
                num_cols[-3][1], num_cols[-2][1], num_cols[-1][1]
            )

            qty   = to_float(qty_str)
            price = to_int(price_str)
            total = to_int(total_str)

            if qty <= 0 or qty > 10000:
                continue

            lines.append({
                "product_code": cells[code_idx],
                "quantity":     qty,
                "unit_price":   price,
                "line_total":   total,
            })

    return {
        "so_number":  so,
        "order_date": order_date,
        "tax_code":   tax_code,
        "footer":     footer,
        "lines":      lines,
    }


def get_db_data(so_number, conn):
    cur = conn.cursor()
    cur.execute("""
        SELECT so.so_number, so.order_date::text, c.tax_code, so.total_amount
        FROM tnbike.sales_order so
        JOIN tnbike.customer c ON c.customer_code = so.customer_code
        WHERE so.so_number = %s
    """, (so_number,))
    row = cur.fetchone()
    if not row:
        cur.close()
        return {"error": "Not found in DB"}

    so, order_date, tax_code, total_amount = row

    cur.execute("""
        SELECT product_code, quantity, unit_price, line_total
        FROM tnbike.order_line
        WHERE so_number = %s
        ORDER BY line_id
    """, (so_number,))
    lines = [
        {
            "product_code": r[0],
            "quantity":     float(r[1]),
            "unit_price":   int(r[2]),
            "line_total":   int(r[3]),
        }
        for r in cur.fetchall()
    ]
    cur.close()

    return {
        "so_number":    so,
        "order_date":   order_date,
        "tax_code":     tax_code,
        "total_amount": int(total_amount),
        "lines":        lines,
    }


def compare(pdf, db):
    issues = []

    if pdf.get("so_number") != db.get("so_number"):
        issues.append("  SO_NUMBER: pdf={} db={}".format(
            pdf.get("so_number"), db.get("so_number")))

    if pdf.get("order_date") != db.get("order_date"):
        issues.append("  ORDER_DATE: pdf={} db={}".format(
            pdf.get("order_date"), db.get("order_date")))

    if pdf.get("tax_code") and db.get("tax_code"):
        if pdf["tax_code"] != db["tax_code"]:
            issues.append("  TAX_CODE: pdf={} db={}".format(
                pdf["tax_code"], db["tax_code"]))

    pdf_lines = pdf.get("lines", [])
    db_lines  = db.get("lines", [])

    if len(pdf_lines) != len(db_lines):
        issues.append("  LINE_COUNT: pdf={} db={}".format(
            len(pdf_lines), len(db_lines)))
    else:
        for i, (pl, dl) in enumerate(zip(pdf_lines, db_lines)):
            if pl["product_code"] != dl["product_code"]:
                issues.append("  LINE{} PRODUCT: pdf={} db={}".format(
                    i + 1, pl["product_code"], dl["product_code"]))
            if abs(pl["quantity"] - dl["quantity"]) > 0.01:
                issues.append("  LINE{} QTY: pdf={} db={}".format(
                    i + 1, pl["quantity"], dl["quantity"]))
            if abs(pl["unit_price"] - dl["unit_price"]) > TOLERANCE:
                issues.append("  LINE{} PRICE: pdf={} db={}".format(
                    i + 1, pl["unit_price"], dl["unit_price"]))
            if abs(pl["line_total"] - dl["line_total"]) > TOLERANCE:
                issues.append("  LINE{} TOTAL: pdf={} db={}".format(
                    i + 1, pl["line_total"], dl["line_total"]))

    if pdf.get("footer") and db.get("total_amount"):
        diff = abs(pdf["footer"] - db["total_amount"])
        if diff > TOLERANCE:
            issues.append("  FOOTER_VS_DB: pdf={} db={} diff={}".format(
                pdf["footer"], db["total_amount"], diff))

    return issues


def main():
    conn = psycopg2.connect(**DB)

    cur = conn.cursor()
    cur.execute(
        "SELECT so_number FROM tnbike.sales_order "
        "WHERE so_number LIKE 'BH26.%%' ORDER BY so_number"
    )
    all_so = [r[0] for r in cur.fetchall()]
    cur.close()

    sample = sorted(all_so)  # check toàn bộ, không random
    print("Spot-checking {} don ngau nhien...\n".format(len(sample)))

    ok = fail = skip = 0
    for so in sample:
        pdf_data = get_pdf_data(so)
        db_data  = get_db_data(so, conn)

        if "error" in pdf_data or "error" in db_data:
            print("[SKIP] {}: {}".format(
                so, pdf_data.get("error") or db_data.get("error")))
            skip += 1
            continue

        issues = compare(pdf_data, db_data)
        if issues:
            print("[FAIL] {}:".format(so))
            for iss in issues:
                print(iss)
            fail += 1
        else:
            print("[OK]   {} -- {} dong, tong {:,} VND".format(
                so, len(db_data["lines"]), db_data["total_amount"]))
            ok += 1

    conn.close()
    print("\n" + "=" * 50)
    print("OK  : {}/{}".format(ok, len(sample)))
    print("FAIL: {}/{}".format(fail, len(sample)))
    print("SKIP: {}/{}".format(skip, len(sample)))


if __name__ == "__main__":
    main()