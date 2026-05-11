"""
feature_engineering.py — Build churn feature matrix from fact_sales.
All features computed as of 2026-03-31 (end of training data).
"""
import pandas as pd
import numpy as np
from db import query

FEATURE_SQL = """
WITH base AS (
    SELECT
        customer_code, customer_name, province_name, region,
        order_date, so_number, line_total,
        fiscal_year, fiscal_quarter
    FROM fact_sales
),
intervals AS (
    SELECT customer_code, order_date,
        order_date - LAG(order_date) OVER (
            PARTITION BY customer_code ORDER BY order_date
        ) AS days_between
    FROM (SELECT DISTINCT customer_code, order_date FROM base) t
),
agg AS (
    SELECT
        customer_code,
        MAX(customer_name)    AS customer_name,
        MAX(province_name)    AS province_name,
        MAX(region)           AS region,
        -- Recency
        DATE '2026-03-31' - MAX(order_date)                       AS recency_days,
        -- Frequency (all time)
        COUNT(DISTINCT so_number)                                  AS frequency,
        -- Monetary (all time)
        SUM(line_total)                                            AS monetary,
        -- Last 90 days (Jan-Mar 2026)
        COUNT(DISTINCT CASE WHEN order_date >= '2026-01-01' THEN so_number END) AS freq_90d,
        COALESCE(SUM(CASE WHEN order_date >= '2026-01-01' THEN line_total END), 0) AS mon_90d,
        -- Average order value
        SUM(line_total) / COUNT(DISTINCT so_number)                AS avg_order_value,
        -- Months active
        COUNT(DISTINCT DATE_TRUNC('month', order_date))            AS months_active,
        -- Q1 YoY
        COALESCE(SUM(CASE WHEN fiscal_year=2026 AND fiscal_quarter=1 THEN line_total END), 0) AS q1_2026,
        COALESCE(SUM(CASE WHEN fiscal_year=2025 AND fiscal_quarter=1 THEN line_total END), 0) AS q1_2025
    FROM base
    GROUP BY customer_code
),
interval_agg AS (
    SELECT customer_code, AVG(days_between) AS avg_order_interval_days
    FROM intervals
    WHERE days_between IS NOT NULL
    GROUP BY customer_code
)
SELECT
    a.*,
    COALESCE(ia.avg_order_interval_days, 999)                     AS avg_interval_days,
    CASE WHEN a.q1_2025 > 0
         THEN ROUND(100.0 * (a.q1_2026 - a.q1_2025) / a.q1_2025, 1)
         ELSE 0 END                                                AS qoq_pct
FROM agg a
LEFT JOIN interval_agg ia USING (customer_code)
"""

FEATURES = [
    # recency_days intentionally excluded — it IS the churn label (>45 days)
    # including it causes data leakage (AUC → 1.0 trivially)
    "frequency", "monetary",
    "freq_90d", "mon_90d", "avg_order_value",
    "months_active", "avg_interval_days", "qoq_pct",
]

CHURN_THRESHOLD_DAYS = 45


def build_features() -> pd.DataFrame:
    """Return feature matrix + meta columns for all 702 dealers."""
    df = query(FEATURE_SQL)
    for col in FEATURES:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    df["is_churned"] = (df["recency_days"] > CHURN_THRESHOLD_DAYS).astype(int)
    return df
