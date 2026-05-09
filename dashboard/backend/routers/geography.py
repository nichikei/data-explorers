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
