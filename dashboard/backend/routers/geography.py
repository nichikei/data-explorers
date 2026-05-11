from fastapi import APIRouter
from db import query

router = APIRouter(prefix="/api/geography", tags=["geography"])


@router.get("/provinces")
def provinces():
    df = query("""
        SELECT
            COALESCE(region, 'Không xác định')       AS region,
            COALESCE(province_name, 'Không xác định') AS province_name,
            SUM(line_total)                           AS revenue,
            COUNT(DISTINCT so_number)                 AS order_count,
            COUNT(DISTINCT customer_code)             AS dealer_count,
            SUM(quantity)                             AS quantity,
            ROUND(SUM(line_total) /
                NULLIF(COUNT(DISTINCT customer_code), 0), 0) AS avg_revenue_per_dealer
        FROM fact_sales
        GROUP BY region, province_name
        ORDER BY revenue DESC
    """)
    return df.to_dict(orient="records")


@router.get("/province_growth")
def province_growth():
    """YoY growth Q1/2025 vs Q1/2026 by province."""
    df = query("""
        SELECT
            COALESCE(province_name, 'Không xác định') AS province_name,
            COALESCE(region, 'Không xác định')        AS region,
            SUM(CASE WHEN fiscal_year=2025 AND fiscal_quarter=1 THEN line_total END) AS rev_q1_2025,
            SUM(CASE WHEN fiscal_year=2026 AND fiscal_quarter=1 THEN line_total END) AS rev_q1_2026,
            ROUND(100.0 *
                (SUM(CASE WHEN fiscal_year=2026 AND fiscal_quarter=1 THEN line_total END) -
                 SUM(CASE WHEN fiscal_year=2025 AND fiscal_quarter=1 THEN line_total END)) /
                NULLIF(SUM(CASE WHEN fiscal_year=2025 AND fiscal_quarter=1 THEN line_total END), 0)
            , 1) AS yoy_pct
        FROM fact_sales
        GROUP BY province_name, region
        HAVING SUM(CASE WHEN fiscal_year=2025 AND fiscal_quarter=1 THEN line_total END) > 0
            OR SUM(CASE WHEN fiscal_year=2026 AND fiscal_quarter=1 THEN line_total END) > 0
        ORDER BY yoy_pct DESC NULLS LAST
    """)
    return df.to_dict(orient="records")


@router.get("/regions")
def regions():
    df = query("""
        SELECT
            COALESCE(region, 'Không xác định') AS region,
            SUM(line_total)                    AS revenue,
            COUNT(DISTINCT so_number)          AS order_count,
            COUNT(DISTINCT customer_code)      AS dealer_count,
            SUM(quantity)                      AS quantity
        FROM fact_sales
        GROUP BY region
        ORDER BY revenue DESC
    """)
    total = df["revenue"].sum()
    df["pct"] = (df["revenue"] / total * 100).round(1)
    return df.to_dict(orient="records")
