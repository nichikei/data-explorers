from fastapi import APIRouter
from db import query

router = APIRouter(prefix="/api/time", tags=["time"])


@router.get("/monthly")
def monthly():
    df = query("""
        SELECT
            fiscal_year,
            fiscal_month,
            TO_CHAR(DATE_TRUNC('month', MIN(order_date)), 'YYYY-MM-DD') AS period,
            group_name,
            SUM(line_total)           AS revenue,
            SUM(quantity)             AS quantity,
            COUNT(DISTINCT so_number) AS orders
        FROM fact_sales
        WHERE group_name IS NOT NULL
        GROUP BY fiscal_year, fiscal_month, group_name
        ORDER BY fiscal_year, fiscal_month, revenue DESC
    """)
    return df.to_dict(orient="records")


@router.get("/yoy_q1")
def yoy_q1():
    df = query("""
        SELECT
            group_name,
            SUM(CASE WHEN fiscal_year=2025 AND fiscal_quarter=1 THEN line_total END) AS q1_2025,
            SUM(CASE WHEN fiscal_year=2026 AND fiscal_quarter=1 THEN line_total END) AS q1_2026,
            ROUND(
                100.0 *
                (SUM(CASE WHEN fiscal_year=2026 AND fiscal_quarter=1 THEN line_total END) -
                 SUM(CASE WHEN fiscal_year=2025 AND fiscal_quarter=1 THEN line_total END)) /
                NULLIF(SUM(CASE WHEN fiscal_year=2025 AND fiscal_quarter=1 THEN line_total END), 0)
            , 1) AS yoy_pct
        FROM fact_sales
        WHERE group_name IS NOT NULL
        GROUP BY group_name
        ORDER BY q1_2026 DESC NULLS LAST
    """)
    return df.to_dict(orient="records")


@router.get("/heatmap")
def heatmap():
    """Month x Year revenue matrix for heatmap."""
    df = query("""
        SELECT
            fiscal_year,
            fiscal_month,
            SUM(line_total) AS revenue
        FROM fact_sales
        GROUP BY fiscal_year, fiscal_month
        ORDER BY fiscal_year, fiscal_month
    """)
    return df.to_dict(orient="records")


@router.get("/mom_waterfall")
def mom_waterfall():
    df = query("""
        WITH monthly AS (
            SELECT
                fiscal_year, fiscal_month,
                TO_CHAR(DATE_TRUNC('month', MIN(order_date)), 'MM/YYYY') AS label,
                SUM(line_total) AS revenue
            FROM fact_sales
            GROUP BY fiscal_year, fiscal_month
        )
        SELECT
            label,
            revenue,
            COALESCE(revenue - LAG(revenue) OVER (ORDER BY fiscal_year, fiscal_month), 0) AS mom_change
        FROM monthly
        ORDER BY fiscal_year, fiscal_month
    """)
    return df.to_dict(orient="records")
