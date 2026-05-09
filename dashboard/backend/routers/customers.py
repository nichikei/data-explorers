from fastapi import APIRouter
from db import query

router = APIRouter(prefix="/api/customers", tags=["customers"])


@router.get("/rfm")
def rfm():
    df = query("""
        WITH rfm_raw AS (
            SELECT
                customer_code,
                customer_name,
                province_name,
                region,
                MAX(order_date)                AS last_order_date,
                CURRENT_DATE - MAX(order_date) AS recency_days,
                COUNT(DISTINCT so_number)       AS frequency,
                SUM(line_total)                 AS monetary
            FROM fact_sales
            GROUP BY customer_code, customer_name, province_name, region
        ),
        scored AS (
            SELECT *,
                NTILE(5) OVER (ORDER BY recency_days ASC)  AS r_score,
                NTILE(5) OVER (ORDER BY frequency DESC)    AS f_score,
                NTILE(5) OVER (ORDER BY monetary DESC)     AS m_score
            FROM rfm_raw
        )
        SELECT *,
            (r_score + f_score + m_score) AS rfm_total
        FROM scored
        ORDER BY rfm_total DESC
    """)

    def segment(total):
        if total is None:
            return "Unknown"
        if total >= 13:
            return "Champions"
        elif total >= 10:
            return "Loyal"
        elif total >= 7:
            return "Promising"
        elif total >= 4:
            return "At Risk"
        else:
            return "Lost"

    df["segment"] = df["rfm_total"].apply(segment)
    return df.to_dict(orient="records")


@router.get("/churn")
def churn(threshold: int = 45):
    df = query("""
        SELECT
            customer_code,
            customer_name,
            province_name,
            region,
            last_order_date,
            days_since_last_order,
            total_orders,
            total_revenue
        FROM v_customer_activity
        WHERE days_since_last_order > %(threshold)s
        ORDER BY days_since_last_order DESC
        LIMIT 200
    """, params={"threshold": threshold})
    return df.to_dict(orient="records")


@router.get("/top")
def top_dealers(limit: int = 10):
    df = query("""
        SELECT
            customer_code,
            customer_name,
            province_name,
            region,
            SUM(line_total)           AS revenue,
            COUNT(DISTINCT so_number) AS orders,
            SUM(quantity)             AS quantity
        FROM fact_sales
        GROUP BY customer_code, customer_name, province_name, region
        ORDER BY revenue DESC
        LIMIT %(limit)s
    """, params={"limit": limit})
    return df.to_dict(orient="records")


@router.get("/pareto")
def pareto():
    df = query("""
        WITH customer_rev AS (
            SELECT
                customer_code,
                SUM(line_total) AS revenue
            FROM fact_sales
            GROUP BY customer_code
        ),
        ranked AS (
            SELECT *,
                RANK() OVER (ORDER BY revenue DESC)                                               AS rnk,
                COUNT(*) OVER ()                                                                   AS total_dealers,
                SUM(revenue) OVER ()                                                               AS total_rev,
                SUM(revenue) OVER (ORDER BY revenue DESC ROWS UNBOUNDED PRECEDING)                AS cum_rev
            FROM customer_rev
        )
        SELECT
            rnk,
            customer_code,
            revenue,
            total_dealers,
            ROUND(100.0 * rnk / total_dealers, 1)    AS dealer_pct,
            ROUND(100.0 * cum_rev / total_rev,  1)   AS cumulative_pct
        FROM ranked
        ORDER BY rnk
    """)
    return df.to_dict(orient="records")
