"""
db.py — Connection pool + query helper cho FastAPI backend.
"""
import os
import json
import urllib.parse
from pathlib import Path

import pandas as pd
import psycopg2
from psycopg2 import pool
from dotenv import load_dotenv

# Local dev: walk up from this file to find .env; Railway: env vars already injected
for _p in Path(__file__).resolve().parents:
    if (_p / ".env").exists():
        load_dotenv(_p / ".env")
        break

_pool: pool.SimpleConnectionPool | None = None


def _pg_kwargs() -> dict:
    """Support both Railway's DATABASE_URL and individual PG_* vars for local dev."""
    url = os.getenv("DATABASE_URL")
    if url:
        r = urllib.parse.urlparse(url)
        return dict(
            host=r.hostname,
            port=r.port or 5432,
            dbname=r.path.lstrip("/"),
            user=r.username,
            password=r.password,
        )
    return dict(
        host=os.getenv("PG_HOST", "localhost"),
        port=int(os.getenv("PG_PORT", "5432")),
        dbname=os.getenv("PG_DB", "tnbike_db"),
        user=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD", ""),
    )


def get_pool() -> pool.SimpleConnectionPool:
    global _pool
    if _pool is None:
        _pool = pool.SimpleConnectionPool(minconn=1, maxconn=10, **_pg_kwargs())
    return _pool


def query(sql: str, params=None) -> pd.DataFrame:
    """Execute SELECT and return DataFrame. NaN/None handled for JSON safety."""
    p = get_pool()
    conn = p.getconn()
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SET search_path TO tnbike, public;")
        df = pd.read_sql(sql, conn, params=params)
        # Convert to object dtype so None replaces NaN properly before JSON
        return df.astype(object).where(pd.notna(df), other=None)
    finally:
        p.putconn(conn)


def df_to_records(df: pd.DataFrame) -> list:
    """Safe JSON-serializable records — converts NaN to null via JSON round-trip."""
    return json.loads(df.to_json(orient="records"))


def scalar(sql: str, params=None):
    """Execute and return first cell value."""
    df = query(sql, params)
    if df.empty:
        return None
    return df.iloc[0, 0]
