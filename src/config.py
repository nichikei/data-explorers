"""
config.py — Cấu hình tập trung cho pipeline.

Đọc biến môi trường từ .env, cung cấp helper get_conn() để các module khác dùng.
"""
import os
import logging
from contextlib import contextmanager
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# ----------------------------------------------------------------------------
# Load .env (file ở cùng thư mục cha của src/)
# ----------------------------------------------------------------------------
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

# ----------------------------------------------------------------------------
# DB config
# ----------------------------------------------------------------------------
PG_CONFIG = {
    "host":     os.getenv("PG_HOST", "localhost"),
    "port":     int(os.getenv("PG_PORT", "5432")),
    "dbname":   os.getenv("PG_DB",   "tnbike_db"),
    "user":     os.getenv("PG_USER", "postgres"),
    "password": os.getenv("PG_PASSWORD", ""),
}
PG_SCHEMA = os.getenv("PG_SCHEMA", "tnbike")

# ----------------------------------------------------------------------------
# Đường dẫn dữ liệu
# ----------------------------------------------------------------------------
EML_DIR         = Path(os.getenv("EML_DIR",         ROOT_DIR / "data/eml/"))
PDF_OUT_DIR     = Path(os.getenv("PDF_OUT_DIR",     ROOT_DIR / "staging/pdf/"))
EXTRACTED_JSONL = Path(os.getenv("EXTRACTED_JSONL", ROOT_DIR / "staging/extracted.jsonl"))
ERRORS_CSV      = Path(os.getenv("ERRORS_CSV",      ROOT_DIR / "staging/errors.csv"))
LOG_FILE        = ROOT_DIR / "logs/pipeline.log"

PDF_OUT_DIR.mkdir(parents=True, exist_ok=True)
EXTRACTED_JSONL.parent.mkdir(parents=True, exist_ok=True)
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

TOTAL_TOLERANCE = int(os.getenv("TOTAL_TOLERANCE", "2"))

# ----------------------------------------------------------------------------
# Logging — vừa log ra console vừa ghi file
# ----------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)


# ----------------------------------------------------------------------------
# Helper: Context manager cho DB connection
# ----------------------------------------------------------------------------
@contextmanager
def get_conn(autocommit: bool = False):
    """
    Sử dụng:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(...)
            conn.commit()
    """
    conn = psycopg2.connect(**PG_CONFIG)
    conn.autocommit = autocommit
    try:
        # Đặt search_path cho mọi query
        with conn.cursor() as cur:
            cur.execute(f"SET search_path TO {PG_SCHEMA}, public;")
        yield conn
    finally:
        conn.close()


@contextmanager
def get_dict_cursor():
    """Cursor trả về dict thay vì tuple — tiện cho extract."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            yield cur, conn
