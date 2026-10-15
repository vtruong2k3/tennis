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

# 2. Start Frontend Dev Server (Port 3000)
cd frontend
npm run dev &
FRONTEND_PID=$!
echo "✓ Frontend React Vite server started (PID: $FRONTEND_PID, Port: 3000)"

# Graceful shutdown handler on Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true; echo 'Servers stopped.'; exit 0" SIGINT SIGTERM EXIT

echo ""
echo "=========================================================="
echo "🚀 Hệ thống đã sẵn sàng! Hãy mở trình duyệt truy cập:"
echo "👉 http://localhost:3000"
echo "=========================================================="
echo "Nhấn Ctrl+C để dừng toàn bộ hệ thống."

wait $BACKEND_PID $FRONTEND_PID
