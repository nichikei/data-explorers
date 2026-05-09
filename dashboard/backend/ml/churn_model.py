"""
churn_model.py — Gradient Boosting churn probability predictor.
Trained once at startup, results cached in app.state.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import cross_val_score
from sklearn.pipeline import Pipeline

from ml.feature_engineering import build_features, FEATURES


def train() -> tuple[Pipeline, pd.DataFrame, dict]:
    """
    Train churn model on full dataset using cross-validation for eval.
    Returns (pipeline, df_with_proba, metrics).
    """
    df = build_features()

    X = df[FEATURES].values
    y = df["is_churned"].values

    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", GradientBoostingClassifier(
            n_estimators=200,
            learning_rate=0.05,
            max_depth=3,
            subsample=0.8,
            random_state=42,
        )),
    ])

    # Cross-validation metrics
    cv_scores = cross_val_score(pipe, X, y, cv=5, scoring="roc_auc")

    # Fit on full data for final predictions
    pipe.fit(X, y)
    proba = pipe.predict_proba(X)[:, 1]

    df = df.copy()
    df["churn_proba"] = (proba * 100).round(1)
    df["churn_segment"] = pd.cut(
        proba,
        bins=[0, 0.3, 0.5, 0.7, 1.0],
        labels=["Ổn định", "Theo dõi", "Cảnh báo", "Nguy hiểm"],
    )

    metrics = {
        "roc_auc_mean": round(float(cv_scores.mean()), 3),
        "roc_auc_std": round(float(cv_scores.std()), 3),
        "churn_count": int(y.sum()),
        "total_dealers": int(len(y)),
    }

    return pipe, df, metrics


def get_churn_results(df: pd.DataFrame) -> list[dict]:
    """Convert trained df to API-friendly records, sorted by risk."""
    cols = [
        "customer_code", "customer_name", "province_name", "region",
        "recency_days", "frequency", "monetary",
        "freq_90d", "avg_order_value", "churn_proba", "churn_segment",
    ]
    result = df[cols].copy()
    result["churn_proba"] = result["churn_proba"].astype(float)
    result["churn_segment"] = result["churn_segment"].astype(str)
    result = result.sort_values("churn_proba", ascending=False)
    return result.to_dict(orient="records")
