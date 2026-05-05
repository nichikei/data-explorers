"""
extract_pdf.py — STAGE 2
========================
Đọc các PDF đã tách từ Stage 1 (ứng với email_log.processing_status='PENDING'),
trích xuất:
  - Header: so_number, order_date
  - Customer: tên, MST, địa chỉ
  - Bảng sản phẩm: mã hàng, tên SP, ĐVT, SL, đơn giá, thành tiền
  - Footer: tổng tiền

Đầu ra: ./staging/extracted.jsonl (1 dòng JSON / 1 đơn).
Ghi luôn extracted_payload (JSONB) vào email_log để debug.
"""
import json
import logging
import re
import unicodedata
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Optional

import pdfplumber
from tqdm import tqdm


def nfc(s: str) -> str:
    """Normalize sang NFC để regex match nhất quán bất kể PDF dùng NFC hay NFD."""
    return unicodedata.normalize("NFC", s) if s else s

from config import EXTRACTED_JSONL, get_conn

log = logging.getLogger("stage2.pdf")

# ----------------------------------------------------------------------------
# Regex helpers
# ----------------------------------------------------------------------------
SO_NUMBER_RE = re.compile(r"BH\d{2}\.\d{4}")
DATE_RE      = re.compile(r"Ng[àa]y[:\s]+(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})", re.IGNORECASE)
MST_RE       = re.compile(r"MST[:\s]+(\d{9,13})", re.IGNORECASE)
TOTAL_RE     = re.compile(
    r"T[ổo]ng\s*gi[áa]\s*tr[ịi]\s*[đd][ơo]n\s*h[àa]ng[:\s]+([\d.,]+)",
    re.IGNORECASE,
)
# Mã hàng = chuỗi số dài (15-16 chữ số như 000104002009000)
PRODUCT_CODE_RE = re.compile(
    r"^(?:"
    r"\d{10,18}"                      # 000219002001000 — thuần số dài
    r"|[A-Z]{1,4}\d+(?:[.\-]\d+)+"   # TP0099.0000571 / TP0017.06.27.04
    r"|\d{2,}\.\d{2}\.\d{2}\.\d{3,}" # 156.01.12.0003
    r")$"
)

def to_int(s: str) -> int:
    """'1.898.148' → 1898148 ; '1,898,148.00' → 1898148"""
    if s is None:
        return 0
    cleaned = s.strip().replace(" ", "")
    # Nếu có cả . và , → giả định . là phân tách hàng nghìn (định dạng VN)
    if "." in cleaned and "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned and "." not in cleaned:
        # 1,898,148  → 1898148
        cleaned = cleaned.replace(",", "")
    else:
        cleaned = cleaned.replace(".", "")
    try:
        return int(round(float(cleaned)))
    except ValueError:
        return 0


def parse_qty(s: str) -> Decimal:
    """Số lượng có thể lẻ — '1' '1,5' '2.0' đều OK"""
    if s is None:
        return Decimal("0")
    cleaned = s.strip().replace(" ", "").replace(",", ".")
    try:
        return Decimal(cleaned)
    except Exception:
        return Decimal("0")


# ----------------------------------------------------------------------------
# Header / footer parsing
# ----------------------------------------------------------------------------
COMPANY_MST = "0300397904"  # MST của Thống Nhất — luôn bỏ qua

def parse_header(text: str) -> dict:
    text = nfc(text)
    out = {"so_number": None, "order_date": None,
           "customer_name": None, "tax_code": None, "address": None}

    if m := SO_NUMBER_RE.search(text):
        out["so_number"] = m.group(0)

    if m := DATE_RE.search(text):
        d, mo, y = m.groups()
        try:
            out["order_date"] = datetime(int(y), int(mo), int(d)).date().isoformat()
        except ValueError:
            pass

    # Lấy TẤT CẢ MST, bỏ MST công ty → cái còn lại là MST đại lý
    all_mst = re.findall(r"MST[:\s]+(\d{9,13})", text, re.IGNORECASE)
    customer_mst = next((m for m in all_mst if m != COMPANY_MST), None)
    if customer_mst:
        out["tax_code"] = customer_mst

    # customer_name — regex mềm vì font vỡ "Đại lý" → "■■i lý"
    cust_match = re.search(
        r".{0,5}i\s*l[ýy][:\s]+(.+?)\s+MST[:\s]+\d{9,13}",
        text, re.IGNORECASE | re.DOTALL,
    )
    if cust_match:
        out["customer_name"] = re.sub(r"\s+", " ", cust_match.group(1)).strip()

    # address
    addr_match = re.search(
        r".{0,5}a\s*ch[ỉi■][:\s]+(.+?)(?=\n\s*(?:STT|M[aã]\s*h[aà]|\d+\s+\d{10})|\n\n)",
        text, re.IGNORECASE | re.DOTALL,
    )
    if addr_match:
        out["address"] = re.sub(r"\s+", " ", addr_match.group(1)).strip()

    return out


def parse_footer_total(text: str) -> Optional[int]:
    m = re.search(
        r"T.{0,4}ng\s+gi.{0,3}\s*tr.{0,3}\s*.{0,5}n\s*h.{0,3}ng[:\s]+([\d.,]+)",
        text, re.IGNORECASE,
    )
    if m:
        s = m.group(1).strip().replace(".", "").replace(",", "")
        try:
            return int(s)
        except Exception:
            pass
    return None


# ----------------------------------------------------------------------------
# Table parsing
# ----------------------------------------------------------------------------
def parse_lines(pdf) -> list[dict]:
    """
    Thử 2 chiến lược:
        (1) extract_tables() — pdfplumber tự nhận diện bảng theo đường kẻ
        (2) Fallback: regex trên text dòng-dòng

    Trả list dict [{stt, product_code, product_name, unit, quantity, unit_price, line_total}, ...]
    """
    lines = []
    for page in pdf.pages:
        for tbl in page.extract_tables() or []:
            if not tbl or len(tbl) < 2:
                continue
            # Bỏ header row — heuristic: header chứa "Mã hàng" hoặc "STT"
            header = [(c or "").lower() for c in tbl[0]]
            if not any("mã" in c or "stt" in c for c in header):
                # Có thể bảng không có header — vẫn parse như data
                data_rows = tbl
            else:
                data_rows = tbl[1:]

            for row in data_rows:
                parsed = parse_row(row)
                if parsed:
                    lines.append(parsed)

    # Nếu extract_tables không ra gì → fallback regex
    if not lines:
        text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        lines = parse_lines_from_text(text)

    return lines


def parse_row(row: list) -> Optional[dict]:
    """Một row = list các cell. Heuristic match cột theo pattern."""
    if not row:
        return None
    cells = [(c or "").strip() for c in row]

    # Tìm cột mã hàng (chuỗi số dài)
    code_idx = None
    for i, c in enumerate(cells):
        if PRODUCT_CODE_RE.match(c):
            code_idx = i
            break
    if code_idx is None:
        return None

    # Cột số (cuối) thường là: thành tiền | đơn giá | SL — đếm ngược
    numeric_cells = [(i, c) for i, c in enumerate(cells)
                     if i > code_idx and re.search(r"[\d.,]+", c) and not PRODUCT_CODE_RE.match(c)]
    if len(numeric_cells) < 3:
        return None

    # Theo cấu trúc PDF mẫu: ... SL, Đơn giá, Thành tiền
    qty_cell, price_cell, total_cell = numeric_cells[-3], numeric_cells[-2], numeric_cells[-1]

    # Tên SP = các cell giữa code và qty
    name_cells = cells[code_idx + 1: qty_cell[0]]
    # ĐVT thường là "Chiếc" — tách ra nếu có
    unit = "Chiếc"
    name_parts = []
    for c in name_cells:
        if c.lower() in ("chiếc", "cái", "bộ"):
            unit = c
        else:
            name_parts.append(c)
    product_name = " ".join(name_parts).strip()

    return {
        "stt":           cells[0] if cells[0].isdigit() else None,
        "product_code":  cells[code_idx],
        "product_name":  product_name,
        "unit":          unit,
        "quantity":      str(parse_qty(qty_cell[1])),
        "unit_price":    to_int(price_cell[1]),
        "line_total":    to_int(total_cell[1]),
    }


def parse_lines_from_text(text: str) -> list[dict]:
    """
    Fallback: parse từng dòng text khi extract_tables thất bại.
    Pattern: <STT> <code 10-18 số> <tên SP có khoảng trắng> <ĐVT> <SL> <giá> <thành tiền>
    """
    lines = []
    line_re = re.compile(
        r"^\s*(\d+)\s+"                  # STT
        r"(\d{10,18})\s+"                 # mã hàng
        r"(.+?)\s+"                       # tên SP (lazy)
        r"(Chi[ếe]c|C[áa]i|B[ộo])\s+"     # ĐVT
        r"([\d.,]+)\s+"                   # SL
        r"([\d.,]+)\s+"                   # đơn giá
        r"([\d.,]+)\s*$",                 # thành tiền
        re.IGNORECASE,
    )
    for raw in text.splitlines():
        m = line_re.match(raw)
        if m:
            stt, code, name, unit, qty, price, total = m.groups()
            lines.append({
                "stt": stt,
                "product_code": code,
                "product_name": name.strip(),
                "unit":         unit,
                "quantity":     str(parse_qty(qty)),
                "unit_price":   to_int(price),
                "line_total":   to_int(total),
            })
    return lines


# ----------------------------------------------------------------------------
# Main extract entry
# ----------------------------------------------------------------------------
def extract_one(pdf_path: str) -> dict:
    """Mở 1 PDF, trả full payload. Không raise — báo lỗi qua trường 'error'."""
    payload = {
        "pdf_path": pdf_path, "header": None, "lines": [],
        "footer_total": None, "error": None,
    }
    try:
        with pdfplumber.open(pdf_path) as pdf:
            full_text = nfc("\n".join((p.extract_text() or "") for p in pdf.pages))
            payload["header"]       = parse_header(full_text)
            payload["lines"]        = parse_lines(pdf)
            payload["footer_total"] = parse_footer_total(full_text)
    except Exception as e:
        payload["error"] = f"PDF_PARSE_ERROR: {e}"
    return payload


def run() -> int:
    """Đọc các đơn PENDING, extract, ghi JSONL + cập nhật email_log."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT log_id, message_id, so_number, attachment_name
                FROM email_log
                WHERE processing_status = 'PENDING'
                ORDER BY log_id
            """)
            pending = cur.fetchall()

    if not pending:
        log.warning("Không có email nào ở trạng thái PENDING — Stage 2 skip")
        return 0

    log.info("Stage 2: extract %d PDF", len(pending))
    EXTRACTED_JSONL.unlink(missing_ok=True)

    ok, fail = 0, 0
    with EXTRACTED_JSONL.open("w", encoding="utf-8") as fout, get_conn() as conn:
        with conn.cursor() as cur:
            for log_id, message_id, so_number, attach_name in tqdm(pending, desc="Extracting PDF"):
                # Tìm PDF đã lưu — tên theo so_number ưu tiên
                pdf_candidates = []
                if so_number:
                    pdf_candidates.append(f"{so_number.replace('.', '_')}.pdf")
                if attach_name:
                    pdf_candidates.append(attach_name)

                from config import PDF_OUT_DIR
                pdf_path = None
                for cand in pdf_candidates:
                    p = PDF_OUT_DIR / cand
                    if p.exists():
                        pdf_path = str(p)
                        break

                if pdf_path is None:
                    cur.execute("""UPDATE email_log SET processing_status='FAILED',
                                   error_stage='EXTRACT', error_message=%s
                                   WHERE log_id=%s""",
                                ("PDF file not found in staging", log_id))
                    fail += 1
                    continue

                payload = extract_one(pdf_path)
                payload["message_id"] = message_id
                payload["log_id"]     = log_id

                if payload["error"] or not payload["lines"]:
                    err = payload["error"] or "NO_LINES_PARSED"
                    cur.execute("""UPDATE email_log SET processing_status='FAILED',
                                   error_stage='EXTRACT', error_message=%s,
                                   extracted_payload=%s
                                   WHERE log_id=%s""",
                                (err, json.dumps(payload, ensure_ascii=False, default=str), log_id))
                    fail += 1
                else:
                    cur.execute("""UPDATE email_log SET processing_status='EXTRACTED',
                                   extracted_payload=%s
                                   WHERE log_id=%s""",
                                (json.dumps(payload, ensure_ascii=False, default=str), log_id))
                    fout.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
                    ok += 1
            conn.commit()

    log.info("STAGE 2 done — OK=%d  failed=%d", ok, fail)
    return ok


if __name__ == "__main__":
    run()
