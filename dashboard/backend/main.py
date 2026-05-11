"""
main.py — FastAPI app entry point cho Phase B + C dashboard backend.
Run: uvicorn main:app --port 8000
"""
import os
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import overview, time_analysis, products, customers, geography, operations
from routers import forecast as forecast_router
from chat import router as chat_router


async def _build_caches(app):
    """Train ML models in background thread so startup is non-blocking."""
    loop = asyncio.get_event_loop()

    # Revenue forecast (Prophet — takes ~20-30s)
    try:
        from ml.time_series import train_revenue_forecast
        app.state.revenue_cache = await loop.run_in_executor(
            None, train_revenue_forecast
        )
    except Exception as e:
        print(f"[forecast] revenue cache failed: {e}")
        app.state.revenue_cache = None

    # Color trends (fast SQL + math)
    try:
        from ml.time_series import get_color_forecast
        app.state.color_cache = await loop.run_in_executor(
            None, get_color_forecast
        )
    except Exception as e:
        print(f"[forecast] color cache failed: {e}")
        app.state.color_cache = None

    # Churn model (sklearn GBClassifier)
    try:
        from ml.churn_model import train, get_churn_results
        _, df_churn, metrics = await loop.run_in_executor(None, train)
        app.state.churn_cache = {
            "dealers": get_churn_results(df_churn),
            "metrics": metrics,
        }
    except Exception as e:
        print(f"[forecast] churn cache failed: {e}")
        app.state.churn_cache = None

    print("[startup] All forecast caches ready.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize cache attributes so /api/forecast/status returns immediately
    app.state.revenue_cache = None
    app.state.color_cache = None
    app.state.churn_cache = None
    # Train models in background — doesn't block API startup
    asyncio.create_task(_build_caches(app))
    yield


app = FastAPI(
    title="TNBike Analytics API",
    version="2.0.0",
    lifespan=lifespan,
)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(overview.router)
app.include_router(time_analysis.router)
app.include_router(products.router)
app.include_router(customers.router)
app.include_router(geography.router)
app.include_router(operations.router)
app.include_router(forecast_router.router)
app.include_router(chat_router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "tnbike-analytics-api", "version": "2.0.0"}
