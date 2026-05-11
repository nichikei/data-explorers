"""
forecast.py — Phase C: Q2/2026 demand forecasting endpoints.
Results are computed once at startup and cached in app.state.
"""
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/forecast", tags=["forecast"])


@router.get("/revenue")
def revenue_forecast(request: Request):
    """Q2/2026 revenue forecast per product group (Prophet)."""
    cache = getattr(request.app.state, "revenue_cache", None)
    if cache is None:
        return {"error": "Model not ready — startup still running"}
    return cache


@router.get("/colors")
def color_forecast(request: Request):
    """Color demand trends + Q2 color mix projection + slow-moving SKUs."""
    cache = getattr(request.app.state, "color_cache", None)
    if cache is None:
        return {"error": "Model not ready"}
    return cache


@router.get("/churn")
def churn_forecast(request: Request):
    """Dealer churn probability for next 30 days (GradientBoosting)."""
    cache = getattr(request.app.state, "churn_cache", None)
    if cache is None:
        return {"error": "Model not ready"}
    return cache


@router.get("/status")
def forecast_status(request: Request):
    """Check if all forecast caches are loaded."""
    return {
        "revenue_ready": request.app.state.revenue_cache is not None,
        "color_ready": request.app.state.color_cache is not None,
        "churn_ready": request.app.state.churn_cache is not None,
    }
