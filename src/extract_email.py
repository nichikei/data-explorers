"""
extract_email.py — STAGE 1
==========================
Duyệt thư mục .eml, mỗi file:
  1. Parse header (Message-ID, From, Subject, Date)
  2. Tách PDF đính kèm theo cấu trúc MIME
  3. Lưu PDF vào ./staging/pdf/<so_number>.pdf
  4. INSERT email_log với processing_status = 'PENDING'
     (UPSERT — re-run sẽ update thay vì lỗi UNIQUE)

Đầu ra: bảng email_log có 1.132 dòng PENDING (lần chạy đầu).
"""
import email
import email.policy
import logging
import re
from email.utils import parsedate_to_datetime, parseaddr
from pathlib import Path
from typing import Optional, Tuple

from tqdm import tqdm

from config import EML_DIR, PDF_OUT_DIR, get_conn

log = logging.getLogger("stage1.email")

# Subject thường có dạng: "Đặt hàng BH26.0935 - Long Phú" hoặc "[BH26.0935] Đơn hàng..."
SO_NUMBER_RE = re.compile(r"BH\d{2}\.\d{4}", re.IGNORECASE)


def parse_eml_file(eml_path: Path) -> Optional[dict]:
    """
    Parse một file .eml, trích header và tách PDF đính kèm.
    Return dict hoặc None nếu lỗi không thể recover.
    """
    try:
        with open(eml_path, "rb") as fh:
            msg = email.message_from_binary_file(fh, policy=email.policy.default)
    except Exception as e:
        log.error("Không đọc được %s: %s", eml_path.name, e)
        return None

    # ----- Header -----
    message_id  = (msg.get("Message-ID") or f"<no-id-{eml_path.stem}>").strip()
    from_addr   = parseaddr(msg.get("From", ""))[1]
    subject     = msg.get("Subject", "") or ""
    date_str    = msg.get("Date", "")
    received_at = None
    if date_str:
        try:
            received_at = parsedate_to_datetime(date_str)
        except Exception:
            pass

    # so_number ưu tiên lấy từ Subject, fallback từ tên file
    so_match = SO_NUMBER_RE.search(subject) or SO_NUMBER_RE.search(eml_path.stem)
    so_number = so_match.group(0).upper() if so_match else None

    # ----- Tách PDF đính kèm -----
    pdf_bytes, pdf_name = extract_pdf_attachment(msg)
    if pdf_bytes is None:
        log.warning("[%s] Không có PDF đính kèm — bỏ qua", eml_path.name)
        return {
            "message_id": message_id, "from_address": from_addr,
            "subject": subject, "received_at": received_at,
            "attachment_name": None, "so_number": so_number,
            "pdf_path": None, "error": "NO_PDF_ATTACHMENT",
        }

    # Lưu PDF với tên chuẩn hóa theo so_number để dễ truy vết
    safe_name = (so_number or eml_path.stem).replace(".", "_")
    out_path  = PDF_OUT_DIR / f"{safe_name}.pdf"
    out_path.write_bytes(pdf_bytes)

    return {
        "message_id":     message_id,
        "from_address":   from_addr,
        "subject":        subject,
        "received_at":    received_at,
        "attachment_name": pdf_name,
        "so_number":      so_number,
        "pdf_path":       str(out_path),
        "error":          None,
    }


def extract_pdf_attachment(msg) -> Tuple[Optional[bytes], Optional[str]]:
    """
    Đi dọc cây MIME, trả PDF đầu tiên tìm thấy.
    Một email có thể có:
        multipart/mixed
          ├── text/plain  (body)
          ├── text/html   (body)
          └── application/pdf  ← đính kèm
    """
    for part in msg.walk():
        ctype = part.get_content_type()
        disp  = (part.get("Content-Disposition") or "").lower()
        fname = part.get_filename() or ""
        # Bắt PDF qua content-type HOẶC qua tên file kết thúc .pdf
        if ctype == "application/pdf" or fname.lower().endswith(".pdf"):
            payload = part.get_payload(decode=True)
            if payload:
                return payload, fname or "attachment.pdf"
    return None, None


# ----------------------------------------------------------------------------
# DB: UPSERT email_log
# ----------------------------------------------------------------------------
UPSERT_SQL = """
INSERT INTO email_log (message_id, from_address, subject, received_at,
                       attachment_name, so_number, processing_status)
VALUES (%s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (message_id) DO UPDATE SET
    from_address    = EXCLUDED.from_address,
    subject         = EXCLUDED.subject,
    received_at     = EXCLUDED.received_at,
    attachment_name = EXCLUDED.attachment_name,
    so_number       = EXCLUDED.so_number
WHERE email_log.processing_status IN ('PENDING','FAILED')
RETURNING log_id, processing_status;
"""


def run() -> int:
    """Main entry — duyệt EML_DIR, ghi email_log, trả số email đã xử lý."""
    eml_files = sorted(EML_DIR.glob("*.eml"))
    if not eml_files:
        log.error("Không tìm thấy file .eml nào trong %s", EML_DIR)
        return 0

    log.info("Tìm thấy %d file .eml — bắt đầu parse", len(eml_files))
    ok, no_pdf, errors = 0, 0, 0

    with get_conn() as conn:
        with conn.cursor() as cur:
            for eml in tqdm(eml_files, desc="Parsing .eml"):
                meta = parse_eml_file(eml)
                if meta is None:
                    errors += 1
                    continue

                status = "PENDING" if meta["error"] is None else "FAILED"
                if meta["error"] == "NO_PDF_ATTACHMENT":
                    no_pdf += 1

                cur.execute(UPSERT_SQL, (
                    meta["message_id"],
                    meta["from_address"],
                    meta["subject"],
                    meta["received_at"],
                    meta["attachment_name"],
                    meta["so_number"],
                    status,
                ))
                if meta["error"]:
                    cur.execute(
                        "UPDATE email_log SET error_stage='EXTRACT', error_message=%s "
                        "WHERE message_id=%s",
                        (meta["error"], meta["message_id"]),
                    )
                if status == "PENDING":
                    ok += 1
            conn.commit()

    log.info("STAGE 1 done — OK=%d  no_pdf=%d  errors=%d", ok, no_pdf, errors)
    return ok


if __name__ == "__main__":
    run()
