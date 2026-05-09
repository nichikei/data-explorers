"""
main.py — FastAPI app entry point cho Phase B dashboard backend.
Run: uvicorn main:app --reload --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import overview, time_analysis, products, customers, geography, operations
from chat import router as chat_router

app = FastAPI(title="TNBike Analytics API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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
app.include_router(chat_router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "tnbike-analytics-api"}
