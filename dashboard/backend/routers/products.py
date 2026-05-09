from fastapi import APIRouter
from db import query

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("/hierarchy")
def hierarchy():
    """Group → Line → SKU with revenue for sunburst."""
    df = query("""
        SELECT
            group_name,
            COALESCE(line_name, 'Chưa phân loại') AS line_name,
            product_code,
            COALESCE(product_name, product_code)   AS product_name,
            SUM(line_total) AS revenue,
            SUM(quantity)   AS quantity
        FROM fact_sales
        WHERE group_name IS NOT NULL
        GROUP BY group_name, line_name, product_code, product_name
        ORDER BY revenue DESC
    """)
    return df.to_dict(orient="records")


@router.get("/bcg")
def bcg():
    """BCG matrix at group level: YoY growth vs revenue share."""
    df = query("""
        WITH data AS (
            SELECT
                group_name,
                SUM(CASE WHEN fiscal_year=2025 AND fiscal_quarter=1 THEN line_total END) AS q1_2025,
                SUM(CASE WHEN fiscal_year=2026 AND fiscal_quarter=1 THEN line_total END) AS q1_2026,
                SUM(line_total)  AS total_rev,
                SUM(quantity)    AS total_qty
            FROM fact_sales
            WHERE group_name IS NOT NULL
            GROUP BY group_name
        ),
        total AS (SELECT SUM(total_rev) AS t FROM data)
        SELECT
            d.group_name,
            d.q1_2025,
            d.q1_2026,
            d.total_rev,
            d.total_qty,
            ROUND(100.0 * d.total_rev / t.t, 1) AS revenue_share_pct,
            ROUND(
                100.0 * (d.q1_2026 - d.q1_2025) / NULLIF(d.q1_2025, 0)
            , 1) AS yoy_pct
        FROM data d, total t
        ORDER BY total_rev DESC
    """)
    # Label BCG quadrant
    median_rev = df["total_rev"].median()
    GROWTH_THRESHOLD = 10.0

    def label(row):
        high_rev = row["total_rev"] and row["total_rev"] > median_rev
        high_growth = row["yoy_pct"] and row["yoy_pct"] > GROWTH_THRESHOLD
        if high_rev and high_growth:
            return "Stars"
        elif high_rev:
            return "Cash Cows"
        elif high_growth:
            return "Question Marks"
        else:
            return "Dogs"

    df["quadrant"] = df.apply(label, axis=1)
    return df.to_dict(orient="records")


@router.get("/bcg_line")
def bcg_line():
    """BCG matrix at product_line level for detailed view."""
    df = query("""
        WITH data AS (
            SELECT
                line_name,
                group_name,
                SUM(CASE WHEN fiscal_year=2025 AND fiscal_quarter=1 THEN line_total END) AS q1_2025,
                SUM(CASE WHEN fiscal_year=2026 AND fiscal_quarter=1 THEN line_total END) AS q1_2026,
                SUM(line_total)  AS total_rev,
                SUM(quantity)    AS total_qty
            FROM fact_sales
            WHERE group_name IS NOT NULL AND line_name IS NOT NULL
            GROUP BY line_name, group_name
        ),
        total AS (SELECT SUM(total_rev) AS t FROM data)
        SELECT
            d.line_name,
            d.group_name,
            d.q1_2025,
            d.q1_2026,
            d.total_rev,
            d.total_qty,
            ROUND(100.0 * d.total_rev / t.t, 1) AS revenue_share_pct,
            ROUND(
                100.0 * (d.q1_2026 - d.q1_2025) / NULLIF(d.q1_2025, 0)
            , 1) AS yoy_pct
        FROM data d, total t
        ORDER BY total_rev DESC
    """)
    median_rev = df["total_rev"].median()
    GROWTH_THRESHOLD = 10.0

    def label(row):
        high_rev = row["total_rev"] and row["total_rev"] > median_rev
        high_growth = row["yoy_pct"] and row["yoy_pct"] > GROWTH_THRESHOLD
        if high_rev and high_growth:
            return "Stars"
        elif high_rev:
            return "Cash Cows"
        elif high_growth:
            return "Question Marks"
        else:
            return "Dogs"

    df["quadrant"] = df.apply(label, axis=1)
    return df.to_dict(orient="records")


@router.get("/colors")
def colors():
    """Color × line_name heatmap data (top 25 lines by revenue)."""
    df = query("""
        WITH top_lines AS (
            SELECT line_name
            FROM fact_sales
            WHERE line_name IS NOT NULL
            GROUP BY line_name
            ORDER BY SUM(line_total) DESC
            LIMIT 25
        )
        SELECT
            COALESCE(f.color, 'Không rõ') AS color,
            f.line_name,
            SUM(f.quantity)   AS total_qty,
            SUM(f.line_total) AS revenue
        FROM fact_sales f
        JOIN top_lines tl ON tl.line_name = f.line_name
        WHERE f.line_name IS NOT NULL AND f.color IS NOT NULL
        GROUP BY f.color, f.line_name
        ORDER BY color, total_qty DESC
    """)
    return df.to_dict(orient="records")


@router.get("/top_sku")
def top_sku(limit: int = 20, order: str = "top"):
    sort = "DESC" if order == "top" else "ASC"
    df = query(f"""
        SELECT
            product_code,
            COALESCE(product_name, product_code) AS product_name,
            COALESCE(color, '')   AS color,
            COALESCE(line_name, 'Chưa phân loại')  AS line_name,
            COALESCE(group_name, 'Chưa phân loại') AS group_name,
            SUM(quantity)             AS total_qty,
            SUM(line_total)           AS revenue,
            COUNT(DISTINCT so_number) AS orders
        FROM fact_sales
        GROUP BY product_code, product_name, color, line_name, group_name
        ORDER BY revenue {sort}
        LIMIT %(limit)s
    """, params={"limit": limit})
    return df.to_dict(orient="records")
