"""
refresh_fact.py — STAGE 5
=========================
Sau khi Stage 4 load xong order_line, refresh fact_sales bằng cách INSERT
các dòng order_line mới chưa có trong fact_sales.

Cũng in báo cáo nhanh số dòng theo từng tháng để bạn verify.
"""
import logging
from pathlib import Path

from config import get_conn

log = logging.getLogger("stage5.fact")

REFRESH_SQL = """
INSERT INTO fact_sales (
    order_date, fiscal_year, fiscal_quarter, fiscal_month, week_of_year,
    so_number, order_id, line_id,
    customer_code, customer_name, province_id, province_name, region,
    product_code, product_name, color, line_id_fk, line_name,
    group_code, group_name,
    quantity, unit_price, line_total
)
SELECT
    so.order_date, so.fiscal_year, so.fiscal_quarter, so.fiscal_month,
    EXTRACT(WEEK FROM so.order_date)::SMALLINT,
    so.so_number, so.order_id, ol.line_id,
    c.customer_code, c.customer_name, c.province_id, p.province_name, p.region,
    pr.product_code, pr.product_name, pr.color,
    pr.line_id, pl.line_name, pg.group_code, pg.group_name,
    ol.quantity, ol.unit_price, ol.line_total
FROM order_line ol
JOIN sales_order so ON so.order_id     = ol.order_id
JOIN customer    c  ON c.customer_code = so.customer_code
LEFT JOIN province     p  ON p.province_id  = c.province_id
JOIN product     pr ON pr.product_code = ol.product_code
LEFT JOIN product_line  pl ON pl.line_id    = pr.line_id
LEFT JOIN product_group pg ON pg.group_code = pl.group_code
WHERE ol.line_id NOT IN (SELECT line_id FROM fact_sales);
"""

REPORT_SQL = """
SELECT fiscal_year, fiscal_month,
       COUNT(*)                  AS rows,
       COUNT(DISTINCT so_number) AS orders,
       SUM(line_total)::BIGINT   AS revenue
FROM fact_sales
GROUP BY fiscal_year, fiscal_month
ORDER BY fiscal_year, fiscal_month;
"""


def run() -> int:
    log.info("Stage 5: refresh fact_sales...")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(REFRESH_SQL)
            inserted = cur.rowcount
            conn.commit()
            log.info("Đã insert thêm %d dòng vào fact_sales", inserted)

            cur.execute(REPORT_SQL)
            log.info("=== fact_sales theo tháng ===")
            log.info("%-6s %-6s %-10s %-10s %-15s", "year", "month", "rows", "orders", "revenue")
            for y, m, rows, orders, rev in cur.fetchall():
                log.info("%-6d %-6d %-10d %-10d %-15s", y, m, rows, orders, f"{rev:,}")

    return inserted


if __name__ == "__main__":
    run()
