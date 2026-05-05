-- ============================================================
-- 99_refresh_fact_sales.sql
-- ============================================================
-- Sau khi load đơn T3/2026 vào order_line/sales_order,
-- ta cần insert thêm dòng tương ứng vào fact_sales.
--
-- Strategy: chỉ INSERT thêm các order_line CHƯA có trong fact_sales
-- (idempotent — chạy lại nhiều lần không lỗi).
-- ============================================================

SET search_path TO tnbike, public;

BEGIN;

INSERT INTO fact_sales (
    order_date, fiscal_year, fiscal_quarter, fiscal_month, week_of_year,
    so_number, order_id, line_id,
    customer_code, customer_name, province_id, province_name, region,
    product_code, product_name, color, line_id_fk, line_name,
    group_code, group_name,
    quantity, unit_price, line_total
)
SELECT
    so.order_date,
    so.fiscal_year,
    so.fiscal_quarter,
    so.fiscal_month,
    EXTRACT(WEEK FROM so.order_date)::SMALLINT,
    so.so_number,
    so.order_id,
    ol.line_id,
    c.customer_code,
    c.customer_name,
    c.province_id,
    p.province_name,
    p.region,
    pr.product_code,
    pr.product_name,
    pr.color,
    pr.line_id      AS line_id_fk,
    pl.line_name,
    pg.group_code,
    pg.group_name,
    ol.quantity,
    ol.unit_price,
    ol.line_total
FROM order_line ol
JOIN sales_order so ON so.order_id     = ol.order_id
JOIN customer    c  ON c.customer_code = so.customer_code
LEFT JOIN province     p  ON p.province_id  = c.province_id
JOIN product     pr ON pr.product_code = ol.product_code
LEFT JOIN product_line pl ON pl.line_id     = pr.line_id
LEFT JOIN product_group pg ON pg.group_code = pl.group_code
WHERE ol.line_id NOT IN (SELECT line_id FROM fact_sales);

-- Báo cáo nhanh
SELECT
    fiscal_year, fiscal_month,
    COUNT(*)           AS rows,
    COUNT(DISTINCT so_number) AS orders,
    SUM(line_total)    AS revenue
FROM fact_sales
GROUP BY fiscal_year, fiscal_month
ORDER BY fiscal_year, fiscal_month;

COMMIT;
