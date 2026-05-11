#!/usr/bin/env bash
# start.sh — Khởi động Phase B dashboard (backend + frontend)
# Chạy từ thư mục phase_a/dashboard/

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== TNBike Analytics Dashboard ==="
echo ""

# Backend
echo "[1/2] Starting FastAPI backend (port 8000)..."
cd "$ROOT/backend"
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACK_PID=$!
echo "      Backend PID: $BACK_PID"

# Wait for backend
sleep 2

# Frontend
echo "[2/2] Starting Next.js frontend (port 3000)..."
cd "$ROOT/frontend"
npm run dev &
FRONT_PID=$!
echo "      Frontend PID: $FRONT_PID"

echo ""
echo "====================================="
echo " Dashboard: http://localhost:3000"
echo " API Docs : http://localhost:8000/docs"
echo "====================================="
echo ""
echo "Press Ctrl+C to stop both services."

# Cleanup on exit
trap "kill $BACK_PID $FRONT_PID 2>/dev/null; echo 'Stopped.'" EXIT INT TERM
wait
