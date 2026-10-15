#!/usr/bin/env bash
# start_all.sh - Starts both Tennis-Vision FastAPI backend and React frontend
set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

echo "=========================================================="
echo " Starting Tennis-Vision Full-Stack AI Platform"
echo " - Backend Engine API: http://localhost:5200"
echo " - React UI (ThreeJS): http://localhost:3000"
echo "=========================================================="

# Determine Python binary with virtualenv
if [ -f ".venv/bin/python" ]; then
    PYTHON_BIN=".venv/bin/python"
elif [ -f "../.venv/bin/python" ]; then
    PYTHON_BIN="../.venv/bin/python"
else
    PYTHON_BIN="python3"
fi

# Clean up any stale processes holding port 5200 or 3000
echo "Kiểm tra và giải phóng cổng 5200 & 3000..."
fuser -k 5200/tcp 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
sleep 0.5

# 1. Start Engine Server (Port 5200) in background
PORT=5200 $PYTHON_BIN engine_server.py &
BACKEND_PID=$!
echo "✓ Backend API server started (PID: $BACKEND_PID, Port: 5200)"

echo "Đang kiểm tra kết nối Backend API (http://localhost:5200)..."
MAX_WAIT=20
COUNT=0
until curl -s http://127.0.0.1:5200/internal/v1/test/runs > /dev/null 2>&1; do
    sleep 0.5
    COUNT=$((COUNT + 1))
    if [ $COUNT -ge $MAX_WAIT ]; then
        echo "❌ Lỗi: Backend API không khởi động được sau 10 giây!"
        kill $BACKEND_PID 2>/dev/null || true
        exit 1
    fi
done
echo "✓ Backend API đã kết nối thành công!"

# 2. Start Frontend Dev Server (Port 3000)
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..
echo "✓ Frontend React Vite server started (PID: $FRONTEND_PID, Port: 3000)"

echo "Đang kiểm tra kết nối Frontend (http://localhost:3000)..."
COUNT=0
until curl -s http://127.0.0.1:3000 > /dev/null 2>&1; do
    sleep 0.5
    COUNT=$((COUNT + 1))
    if [ $COUNT -ge $MAX_WAIT ]; then
        echo "❌ Lỗi: Frontend Vite không khởi động được sau 10 giây!"
        kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
        exit 1
    fi
done
echo "✓ Frontend React Vite đã kết nối thành công!"

# Graceful shutdown handler on Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true; echo 'Servers stopped.'; exit 0" SIGINT SIGTERM EXIT

echo ""
echo "=========================================================="
echo "🚀 HỆ THỐNG ĐÃ SẴN SÀNG 100%! HÃY MỞ TRÌNH DUYỆT TRUY CẬP:"
echo "👉 http://localhost:3000"
echo "=========================================================="
echo "Nhấn Ctrl+C để dừng toàn bộ hệ thống."

wait $BACKEND_PID $FRONTEND_PID
