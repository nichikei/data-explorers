from fastapi import APIRouter
from db import query

router = APIRouter(prefix="/api/operations", tags=["operations"])


@router.get("/pipeline")
def pipeline():
    df = query("""
        SELECT
            processing_status AS status,
            COUNT(*)          AS count
        FROM email_log
        GROUP BY processing_status
        ORDER BY count DESC
    """)
    total = int(df["count"].sum()) if not df.empty else 0
    loaded = int(df.loc[df["status"] == "LOADED", "count"].sum()) if not df.empty else 0
    success_rate = round(loaded / total * 100, 1) if total > 0 else 0
    return {
        "stages": df.to_dict(orient="records"),
        "total": total,
        "loaded": loaded,
        "success_rate": success_rate,
    }


@router.get("/daily")
def daily():
    """Orders per day in T3/2026."""
    df = query("""
        SELECT
            order_date,
            COUNT(DISTINCT so_number) AS order_count,
            SUM(line_total)           AS revenue,
            SUM(quantity)             AS quantity
        FROM fact_sales
        WHERE fiscal_year = 2026 AND fiscal_month = 3
        GROUP BY order_date
        ORDER BY order_date
    """)
    df["order_date"] = df["order_date"].astype(str)
    return df.to_dict(orient="records")


@router.get("/errors")
def errors():
    df = query("""
        SELECT
            log_id,
            so_number,
            from_address,
            processing_status AS status,
            error_message,
            processed_at
        FROM email_log
        WHERE processing_status NOT IN ('LOADED', 'SUCCESS')
        ORDER BY processed_at DESC
        LIMIT 100
    """)
    df["processed_at"] = df["processed_at"].astype(str)
    return df.to_dict(orient="records")


@router.get("/processing_timeline")
def processing_timeline():
    df = query("""
        SELECT
            DATE_TRUNC('hour', processed_at) AS hour_bucket,
            COUNT(*)                          AS processed_count,
            SUM(CASE WHEN processing_status = 'LOADED' THEN 1 ELSE 0 END) AS success_count
        FROM email_log
        GROUP BY hour_bucket
        ORDER BY hour_bucket
    """)
    df["hour_bucket"] = df["hour_bucket"].astype(str)
    return df.to_dict(orient="records")
