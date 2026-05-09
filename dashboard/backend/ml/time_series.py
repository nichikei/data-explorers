"""
time_series.py — Revenue forecasting for Q2/2026.

Strategy:
  - YoY-adjusted baseline: compute Q1 2025→2026 growth, apply damped growth
    to Q1/2026 average, distribute to Q2 months (Apr 0.95, May 1.05, Jun 1.0)
  - Holt's DES (statsmodels) is used only for 1-month backtest
  - Distribute forecast to groups using Q1/2026 proportional mix
  - Color analysis uses historical Q1 YoY growth rates
"""
import warnings
import pandas as pd
import numpy as np
from db import query

warnings.filterwarnings("ignore")

MONTHLY_SQL = """
    SELECT
        DATE_TRUNC('month', order_date)::date AS ds,
        COALESCE(group_name, 'Chưa phân loại') AS group_name,
        group_code,
        SUM(line_total)  AS revenue,
        SUM(quantity)    AS quantity
    FROM fact_sales
    GROUP BY DATE_TRUNC('month', order_date), group_name, group_code
    ORDER BY ds
"""

TOTAL_MONTHLY_SQL = """
    SELECT
        DATE_TRUNC('month', order_date)::date AS ds,
        SUM(line_total) AS revenue
    FROM fact_sales
    GROUP BY DATE_TRUNC('month', order_date)
    ORDER BY ds
"""

COLOR_SQL = """
    SELECT
        fiscal_year, fiscal_month,
        COALESCE(color, 'Không rõ') AS color,
        SUM(quantity)  AS qty,
        SUM(line_total) AS revenue
    FROM fact_sales
    WHERE color IS NOT NULL
    GROUP BY fiscal_year, fiscal_month, color
    ORDER BY fiscal_year, fiscal_month, qty DESC
"""

SKU_SLOW_SQL = """
    SELECT
        product_code, product_name,
        COALESCE(color, 'N/A') AS color,
        COALESCE(line_name, 'N/A') AS line_name,
        COALESCE(group_name, 'N/A') AS group_name,
        SUM(quantity)    AS total_qty,
        SUM(line_total)  AS total_revenue,
        MAX(order_date)  AS last_sale_date,
        DATE '2026-04-01' - MAX(order_date) AS days_no_sale
    FROM fact_sales
    GROUP BY product_code, product_name, color, line_name, group_name
    HAVING SUM(quantity) < 15 OR MAX(order_date) < '2026-01-01'
    ORDER BY days_no_sale DESC, total_qty
    LIMIT 50
"""

TOP_SKU_SQL = """
    SELECT
        product_code, product_name,
        COALESCE(color, 'N/A') AS color,
        COALESCE(line_name, 'N/A') AS line_name,
        COALESCE(group_name, 'N/A') AS group_name,
        SUM(quantity)   AS total_qty,
        SUM(line_total) AS total_revenue
    FROM fact_sales
    WHERE fiscal_year=2026 AND fiscal_month IN (1,2,3)
    GROUP BY product_code, product_name, color, line_name, group_name
    ORDER BY total_revenue DESC
    LIMIT 20
"""

Q2_MONTHS = ["2026-04", "2026-05", "2026-06"]
Q2_LABELS  = {"2026-04": "Tháng 4/2026", "2026-05": "Tháng 5/2026", "2026-06": "Tháng 6/2026"}


def _holt_forecast(series: pd.Series, periods: int) -> np.ndarray:
    """Holt's Double Exponential Smoothing — used only for 1-month backtest."""
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    model = ExponentialSmoothing(
        series.astype(float), trend="add", damped_trend=True, damping_trend=0.85
    )
    fit = model.fit(optimized=True)
    return fit.forecast(periods).values


def _yoy_adjusted_forecast(df_total: pd.DataFrame) -> tuple[np.ndarray, dict]:
    """
    YoY-adjusted baseline forecasting for Q2/2026.

    Logic (given only 6 months: Q1/2025 + Q1/2026):
    1. Compute YoY growth rate from Q1/2025 → Q1/2026 (per month)
    2. Apply dampened growth to Q1/2026 average as Q2 base
    3. Within-Q2 distribution: Apr ~ 0.95×base, May ~ 1.05×base, Jun ~ 1.0×base

    Returns forecast array [Apr, May, Jun] and metadata.
    """
    df = df_total.sort_values("ds").reset_index(drop=True)
    df["ym"] = df["ds"].dt.strftime("%Y-%m")

    q1_25 = {row["ym"]: row["revenue"] for _, row in df.iterrows() if row["ym"] in ["2025-01", "2025-02", "2025-03"]}
    q1_26 = {row["ym"]: row["revenue"] for _, row in df.iterrows() if row["ym"] in ["2026-01", "2026-02", "2026-03"]}

    # Monthly YoY growth rates
    pairs = [("2025-01", "2026-01"), ("2025-02", "2026-02"), ("2025-03", "2026-03")]
    growth_rates = []
    for ym25, ym26 in pairs:
        r25 = q1_25.get(ym25, 0)
        r26 = q1_26.get(ym26, 0)
        if r25 > 0 and r26 > 0:
            growth_rates.append((r26 - r25) / r25)

    # Median growth rate (dampened by 0.5 to avoid over-extrapolation)
    raw_growth = float(np.median(growth_rates)) if growth_rates else 0.15
    dampened_growth = raw_growth * 0.5

    # Q1/2026 monthly average as base
    q1_26_avg = np.mean(list(q1_26.values())) if q1_26 else 0.0

    # Forecast: apply growth to Q1/2026 average, with within-Q2 pattern
    base = q1_26_avg * (1 + dampened_growth)
    within_q2 = np.array([0.95, 1.05, 1.0])   # Apr slightly lower, May peak
    fc = np.maximum(base * within_q2, 0)

    meta = {
        "q1_26_avg_ty": round(q1_26_avg / 1e9, 1),
        "yoy_growth_pct": round(raw_growth * 100, 1) if growth_rates else 0,
        "dampened_growth_pct": round(dampened_growth * 100, 1),
        "method": "YoY-adjusted baseline (damped 50%)",
    }
    return fc, meta


def train_revenue_forecast() -> dict:
    """
    Main forecasting function:
    1. YoY-adjusted baseline for Q2/2026 total revenue
    2. Distribute to groups by Q1/2026 proportional mix
    3. Backtest by leaving out last 1 month (Holt's DES)
    """
    df_group = query(MONTHLY_SQL)
    df_total = query(TOTAL_MONTHLY_SQL)

    df_group["ds"] = pd.to_datetime(df_group["ds"])
    df_total["ds"] = pd.to_datetime(df_total["ds"])
    df_total = df_total.sort_values("ds").reset_index(drop=True)
    df_total["revenue"] = pd.to_numeric(df_total["revenue"], errors="coerce").fillna(0)

    # Historical records for frontend chart
    historical = []
    groups = df_group["group_name"].unique().tolist()
    for _, row in df_group.iterrows():
        historical.append({
            "group": str(row["group_name"]),
            "ds": row["ds"].strftime("%Y-%m"),
            "revenue": float(row["revenue"]),
        })

    # ── Backtest: train on all but last month, predict last month ──
    backtest = {}
    if len(df_total) >= 4:
        train_total = df_total["revenue"].iloc[:-1]
        actual_last = float(df_total["revenue"].iloc[-1])
        try:
            fc_back = _holt_forecast(train_total, periods=1)
            predicted_last = float(fc_back[0])
            last_ds = df_total["ds"].iloc[-1].strftime("%Y-%m")
            for grp in groups:
                grp_last = df_group[
                    (df_group["group_name"] == grp) &
                    (df_group["ds"].dt.strftime("%Y-%m") == last_ds)
                ]["revenue"]
                actual_g = float(grp_last.iloc[0]) if len(grp_last) else 0
                prior_ds = df_total["ds"].iloc[-2].strftime("%Y-%m")
                grp_prior = df_group[
                    (df_group["group_name"] == grp) &
                    (df_group["ds"].dt.strftime("%Y-%m") == prior_ds)
                ]["revenue"]
                prior_total = float(df_group[df_group["ds"].dt.strftime("%Y-%m") == prior_ds]["revenue"].sum())
                share = float(grp_prior.iloc[0]) / max(prior_total, 1) if len(grp_prior) else 0
                predicted_g = predicted_last * share
                mape = abs(actual_g - predicted_g) / max(actual_g, 1) * 100 if actual_g > 0 else 999
                backtest[grp] = {
                    "actual": round(actual_g / 1e9, 2),
                    "predicted": round(predicted_g / 1e9, 2),
                    "mape_pct": round(min(mape, 999), 1),
                }
        except Exception as e:
            print(f"[backtest] error: {e}")

    # ── Q1/2026 group proportions ──
    q1_2026_rev = df_group[
        df_group["ds"].dt.strftime("%Y-%m").isin(["2026-01", "2026-02", "2026-03"])
    ].groupby("group_name")["revenue"].sum()
    total_q1_2026 = float(q1_2026_rev.sum())
    group_shares = {g: float(q1_2026_rev.get(g, 0)) / max(total_q1_2026, 1) for g in groups}

    # ── YoY-adjusted Q2 forecast ──
    try:
        fc_seasonal, meta = _yoy_adjusted_forecast(df_total)
        print(f"[forecast] YoY method — dampened={meta['dampened_growth_pct']}%, "
              f"base={meta['q1_26_avg_ty']}B, Q2 total={round(fc_seasonal.sum()/1e9,1)}B")
    except Exception as e:
        print(f"[forecast] YoY error: {e}")
        q1_monthly_avg = float(df_total["revenue"].iloc[-3:].mean()) if len(df_total) >= 3 else 0.0
        fc_seasonal = np.array([q1_monthly_avg] * 3)

    # ── Build forecast per group ──
    forecasts = []
    total_q2: dict[str, float] = {}
    for i, month in enumerate(Q2_MONTHS):
        month_total = float(fc_seasonal[i])
        for grp in groups:
            share = group_shares.get(grp, 0.0)
            yhat = month_total * share
            lower = yhat * 0.80
            upper = yhat * 1.20
            forecasts.append({
                "group": grp,
                "ds": month,
                "yhat": round(yhat, 0),
                "lower": round(lower, 0),
                "upper": round(upper, 0),
            })
            total_q2[grp] = round(total_q2.get(grp, 0.0) + yhat / 1e9, 2)

    return {
        "historical": historical,
        "forecast": forecasts,
        "total_q2": total_q2,
        "backtest": backtest,
    }


def get_color_forecast() -> dict:
    """Analyze color demand trends and forecast Q2 color mix."""
    df = query(COLOR_SQL)
    df["qty"] = pd.to_numeric(df["qty"], errors="coerce").fillna(0)

    q1_25 = df[(df.fiscal_year == 2025) & (df.fiscal_month.isin([1, 2, 3]))].groupby("color")["qty"].sum()
    q1_26 = df[(df.fiscal_year == 2026) & (df.fiscal_month.isin([1, 2, 3]))].groupby("color")["qty"].sum()
    colors_all = sorted(set(q1_25.index) | set(q1_26.index))

    color_trends = []
    for c in colors_all:
        q25 = float(q1_25.get(c, 0))
        q26 = float(q1_26.get(c, 0))
        yoy = round((q26 - q25) / max(q25, 1) * 100, 1) if q25 > 0 else None
        total_q1_26 = float(q1_26.sum())
        pct_q1_26 = round(q26 / max(total_q1_26, 1) * 100, 1)
        color_trends.append({
            "color": c,
            "qty_q1_2025": round(q25),
            "qty_q1_2026": round(q26),
            "yoy_pct": yoy,
            "pct_of_total_q1_2026": pct_q1_26,
        })

    color_trends.sort(key=lambda x: x["qty_q1_2026"], reverse=True)

    Q2_GROWTH_FACTOR = 1.2
    total_q2_projected = sum(c["qty_q1_2026"] for c in color_trends) * Q2_GROWTH_FACTOR
    q2_mix = []
    for c in color_trends:
        growth_mult = 1 + (c["yoy_pct"] or 0) / 100
        q2_qty = round(c["qty_q1_2026"] * growth_mult * Q2_GROWTH_FACTOR)
        q2_mix.append({
            "color": c["color"],
            "q2_qty_projected": q2_qty,
            "q2_pct": round(q2_qty / max(total_q2_projected, 1) * 100, 1),
            "trend": "tăng" if (c["yoy_pct"] or 0) > 10
                     else "giảm" if (c["yoy_pct"] or 0) < -10
                     else "ổn định",
            "yoy_pct": c["yoy_pct"],
            "qty_q1_2026": c["qty_q1_2026"],
        })
    q2_mix.sort(key=lambda x: x["q2_qty_projected"], reverse=True)

    slow_moving = query(SKU_SLOW_SQL).to_dict(orient="records")
    top_skus = query(TOP_SKU_SQL).to_dict(orient="records")

    return {
        "color_trends": color_trends,
        "q2_color_mix": q2_mix,
        "growing_colors": [c["color"] for c in color_trends if (c["yoy_pct"] or 0) > 10][:5],
        "declining_colors": [c["color"] for c in color_trends if (c["yoy_pct"] or 0) < -10][:5],
        "slow_moving_skus": slow_moving,
        "top_skus_q1_2026": top_skus,
    }
