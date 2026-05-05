-- ============================================================
-- verify_after_import.sql
-- ============================================================
-- Chạy SAU KHI pipeline hoàn thành, để xác nhận dữ liệu T3/2026
-- đã import đúng và đầy đủ.
-- ============================================================

SET search_path TO tnbike, public;

\echo '=== 1. Tổng đơn T3/2026 trong sales_order ==='
SELECT COUNT(*)             AS so_count,
       MIN(order_date)      AS min_date,
       MAX(order_date)      AS max_date,
       SUM(total_amount)    AS revenue_t3
FROM sales_order
WHERE fiscal_year = 2026 AND fiscal_month = 3;

\echo ''
\echo '=== 2. Số dòng order_line T3/2026 ==='
SELECT COUNT(*)              AS line_count,
       SUM(quantity)         AS total_qty,
       SUM(line_total)       AS revenue_t3
FROM order_line ol
JOIN sales_order so ON so.order_id = ol.order_id
WHERE so.fiscal_year = 2026 AND so.fiscal_month = 3;

\echo ''
\echo '=== 3. Status email_log ==='
SELECT processing_status, COUNT(*) AS n
FROM email_log
GROUP BY processing_status
ORDER BY n DESC;

\echo ''
\echo '=== 4. KPI hiệu quả vận hành ==='
SELECT * FROM v_email_processing_kpi;

\echo ''
\echo '=== 5. Top 10 đại lý đặt hàng nhiều nhất T3/2026 ==='
SELECT c.customer_code, c.customer_name,
       COUNT(*)                  AS so_count,
       SUM(so.total_amount)      AS revenue
FROM sales_order so
JOIN customer c ON c.customer_code = so.customer_code
WHERE so.fiscal_year = 2026 AND so.fiscal_month = 3
GROUP BY c.customer_code, c.customer_name
ORDER BY revenue DESC
LIMIT 10;

\echo ''
\echo '=== 6. Số đại lý mới được tạo qua pipeline (KH-XXXXX cao hơn 798) ==='
SELECT COUNT(*) AS new_dealers
FROM customer
WHERE customer_code ~ '^KH-\d+$'
  AND SUBSTRING(customer_code FROM 4)::INT > 798;

\echo ''
\echo '=== 7. fact_sales theo tháng (xác nhận T3/2026 đã có) ==='
SELECT fiscal_year, fiscal_month,
       COUNT(*)                  AS rows,
       COUNT(DISTINCT so_number) AS orders,
       SUM(line_total)::BIGINT   AS revenue
FROM fact_sales
GROUP BY fiscal_year, fiscal_month
ORDER BY fiscal_year, fiscal_month;

\echo ''
\echo '=== 8. Sanity check: tổng line_total = total_amount ==='
SELECT COUNT(*) AS mismatched_orders
FROM (
  SELECT so.so_number, so.total_amount,
         SUM(ol.line_total) AS calc_total
  FROM sales_order so
  JOIN order_line  ol ON ol.order_id = so.order_id
  WHERE so.fiscal_year = 2026 AND so.fiscal_month = 3
  GROUP BY so.so_number, so.total_amount
  HAVING ABS(so.total_amount - SUM(ol.line_total)) > 2
) x;

\echo ''
\echo '=== 9. Kiểm tra orphan: order_line không có sản phẩm trong product ==='
SELECT COUNT(*) AS orphan_lines
FROM order_line ol
LEFT JOIN product p ON p.product_code = ol.product_code
WHERE p.product_code IS NULL;

\echo ''
\echo '=== 10. Top 5 đơn lỗi gần nhất (để debug) ==='
SELECT log_id, so_number, error_stage, LEFT(error_message, 120) AS error
FROM email_log
WHERE processing_status = 'FAILED'
ORDER BY log_id DESC
LIMIT 5;
