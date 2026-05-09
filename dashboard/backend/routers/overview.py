from fastapi import APIRouter
from db import query

router = APIRouter(prefix="/api/overview", tags=["overview"])


@router.get("/kpi")
def kpi():
    df = query("""
        WITH monthly AS (
            SELECT
                fiscal_year, fiscal_month,
                SUM(line_total)              AS revenue,
                COUNT(DISTINCT so_number)    AS orders,
                SUM(quantity)                AS qty,
                COUNT(DISTINCT customer_code) AS dealers
            FROM fact_sales
            GROUP BY fiscal_year, fiscal_month
        ),
        cur  AS (SELECT * FROM monthly WHERE fiscal_year=2026 AND fiscal_month=3),
        prev AS (SELECT * FROM monthly WHERE fiscal_year=2026 AND fiscal_month=2),
        yoy  AS (SELECT * FROM monthly WHERE fiscal_year=2025 AND fiscal_month=3),
        active AS (
            SELECT COUNT(*) AS cnt FROM v_customer_activity
            WHERE days_since_last_order <= 45
        ),
        pareto AS (
            WITH rev AS (
                SELECT customer_code, SUM(line_total) AS r
                FROM fact_sales GROUP BY customer_code
            ),
            total AS (SELECT SUM(r) AS t FROM rev),
            ranked AS (
                SELECT r, RANK() OVER (ORDER BY r DESC) AS rnk,
                       COUNT(*) OVER () AS total_dealers
                FROM rev
            )
            SELECT
                ROUND(100.0 * SUM(r) / MAX(t), 1) AS pct
            FROM ranked, total
            WHERE rnk <= CEIL(total_dealers * 0.2)
        )
        SELECT
            cur.revenue,
            cur.orders,
            cur.qty,
            cur.dealers,
            ROUND(cur.revenue / NULLIF(cur.dealers, 0), 0) AS avg_per_dealer,
            ROUND(100.0 * (cur.revenue - prev.revenue) / NULLIF(prev.revenue, 0), 1) AS mom_revenue_pct,
            ROUND(100.0 * (cur.orders  - prev.orders)  / NULLIF(prev.orders,  0), 1) AS mom_orders_pct,
            ROUND(100.0 * (cur.revenue - yoy.revenue)  / NULLIF(yoy.revenue,  0), 1) AS yoy_revenue_pct,
            (SELECT cnt  FROM active)  AS active_dealers,
            (SELECT pct  FROM pareto)  AS pareto_top20_pct
        FROM cur, prev, yoy
    """)
    if df.empty:
        return {}
    row = df.iloc[0].to_dict()
    return {k: (None if v is None else float(v) if hasattr(v, 'item') else v)
            for k, v in row.items()}


@router.get("/group_revenue")
def group_revenue():
    df = query("""
        SELECT
            COALESCE(group_name, 'Chưa phân loại') AS group_name,
            SUM(line_total) AS revenue,
            SUM(quantity)   AS quantity
        FROM fact_sales
        WHERE fiscal_year = 2026 AND fiscal_month = 3
        GROUP BY group_name
        ORDER BY revenue DESC
    """)
    total = df["revenue"].sum()
    df["pct"] = (df["revenue"] / total * 100).round(1)
    return df.to_dict(orient="records")


@router.get("/sparkline")
def sparkline():
    """Last 15 months revenue for sparkline."""
    df = query("""
        SELECT
            fiscal_year,
            fiscal_month,
            TO_CHAR(DATE_TRUNC('month', MIN(order_date)), 'MM/YYYY') AS label,
            SUM(line_total) AS revenue
        FROM fact_sales
        GROUP BY fiscal_year, fiscal_month
        ORDER BY fiscal_year, fiscal_month
    """)
    return df.to_dict(orient="records")
