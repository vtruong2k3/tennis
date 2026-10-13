"""
engine_server.py

High-performance FastAPI server running on port 4200 that bridges the
Tennis-Vision AI analytics backend with the React/Three.js frontend.

Implements all endpoints defined in frontend/src/api/engine.ts:
- GET  /internal/v1/test/runs
- GET  /internal/v1/test/runs/{runId}/files/{name}
- GET  /internal/v1/test/runs/{runId}/ar-data
- GET  /internal/v1/test/runs/{runId}/video
- GET  /internal/v1/test/runs/{runId}/data.zip
- POST /internal/v1/test/upload
- POST /internal/v1/test/start
- GET  /internal/v1/test/events
- POST /internal/v1/test/cancel/{runId}
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    PlainTextResponse,
    Response,
    StreamingResponse,
)
from sse_starlette.sse import EventSourceResponse

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("tennis_engine_server")

BASE_DIR = Path(__file__).resolve().parent
RUNS_DIR = BASE_DIR / "runs"
UPLOADS_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "output"

RUNS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Tennis-Vision Engine API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active processes and event queues
active_tasks: dict[str, asyncio.Task] = {}
active_subprocesses: dict[str, asyncio.subprocess.Process] = {}
run_event_queues: dict[str, list[asyncio.Queue]] = {}
run_history_events: dict[str, list[dict[str, Any]]] = {}


def get_run_files(run_dir: Path) -> list[str]:
    """Return list of standard files present in a run directory."""
    standard_files = [
        "result.json",
        "heatmap.json",
        "ar-data.json",
        "summary.json",
        "stats.csv",
        "trajectory3d.json",
        "video.mp4",
        "run.log",
    ]
    return [f for f in standard_files if (run_dir / f).exists()]


# ── 1. List runs ─────────────────────────────────────────────────────────────

@app.get("/internal/v1/test/runs")
async def list_runs():
    """
    List runs sorted with newest first.
    Returns: { "runs": [ { runId, status, files, hasVideo, videoVerified }, ... ] }
    """
    runs = []
    if not RUNS_DIR.exists():
        return {"runs": []}

    run_dirs = [p for p in RUNS_DIR.iterdir() if p.is_dir()]
    run_dirs.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    for r_dir in run_dirs:
        run_id = r_dir.name
        meta_path = r_dir / "meta.json"
        meta = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        files = get_run_files(r_dir)
        has_video = (r_dir / "video.mp4").exists() and (r_dir / "video.mp4").stat().st_size > 0
        run_status = meta.get("status", "COMPLETED" if "result.json" in files else "RUNNING")

        runs.append({
            "runId": run_id,
            "status": run_status,
            "files": files,
            "hasVideo": has_video,
            "videoVerified": True,
        })

    return {"runs": runs}


# ── 2. Fetch specific run file ──────────────────────────────────────────────

@app.get("/internal/v1/test/runs/{run_id}/files/{name}")
async def get_run_file(run_id: str, name: str):
    """Serve a specific output file (e.g. result.json, heatmap.json)."""
    run_dir = RUNS_DIR / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    file_path = run_dir / name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File '{name}' not found in run '{run_id}'")

    if name.endswith(".json"):
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            return JSONResponse(content=data)
        except Exception as exc:
            return PlainTextResponse(file_path.read_text(encoding="utf-8"), media_type="application/json")
    elif name.endswith(".csv"):
        return PlainTextResponse(file_path.read_text(encoding="utf-8"), media_type="text/csv")
    elif name.endswith(".log") or name.endswith(".txt"):
        return PlainTextResponse(file_path.read_text(encoding="utf-8"), media_type="text/plain")
    else:
        return FileResponse(file_path)


# ── 3. Fetch AR data ────────────────────────────────────────────────────────

@app.get("/internal/v1/test/runs/{run_id}/ar-data")
async def get_ar_data(run_id: str):
    """Serve ar-data.json for video AR canvas overlays."""
    run_dir = RUNS_DIR / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    ar_path = run_dir / "ar-data.json"
    if not ar_path.exists():
        raise HTTPException(status_code=404, detail=f"ar-data.json not found in run '{run_id}'")

    try:
        data = json.loads(ar_path.read_text(encoding="utf-8"))
        return JSONResponse(content=data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read AR data: {exc}")


# ── 4. Stream MP4 Video with Range support ──────────────────────────────────

@app.api_route("/internal/v1/test/runs/{run_id}/video", methods=["GET", "HEAD"])
async def stream_run_video(run_id: str, request: Request):
    """
    Stream H.264 video with HTTP 206 Partial Content support for smooth seeking.
    """
    run_dir = RUNS_DIR / run_id
    video_path = run_dir / "video.mp4"

    if not video_path.exists():
        fallback = OUTPUT_DIR / "videos" / "test_run.mp4"
        if fallback.exists():
            video_path = fallback
        else:
            raise HTTPException(status_code=404, detail="Video file not found for this run")

    file_size = video_path.stat().st_size

    if request.method == "HEAD":
        return Response(
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
            },
        )
    range_header = request.headers.get("range")

    if not range_header:
        def full_file_iterator():
            with open(video_path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk

        return StreamingResponse(
            full_file_iterator(),
            status_code=200,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
            },
        )

    try:
        byte_range = range_header.replace("bytes=", "").strip()
        parts = byte_range.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
        end = min(end, file_size - 1)
        if start > end:
            start = end
        content_length = (end - start) + 1
    except Exception:
        start = 0
        end = file_size - 1
        content_length = file_size

    def iter_file():
        with open(video_path, "rb") as f:
            f.seek(start)
            bytes_left = content_length
            while bytes_left > 0:
                chunk_to_read = min(1024 * 512, bytes_left)
                data = f.read(chunk_to_read)
                if not data:
                    break
                bytes_left -= len(data)
                yield data

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
        "Content-Type": "video/mp4",
    }
    return StreamingResponse(iter_file(), status_code=206, headers=headers)


# ── 5. Download data.zip ────────────────────────────────────────────────────

@app.get("/internal/v1/test/runs/{run_id}/data.zip")
async def download_run_zip(run_id: str):
    """Package run artifacts into a zip file."""
    run_dir = RUNS_DIR / run_id
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    mem_zip = io.BytesIO()
    with zipfile.ZipFile(mem_zip, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for f in run_dir.iterdir():
            if f.is_file():
                zf.write(f, arcname=f.name)

    mem_zip.seek(0)
    return Response(
        content=mem_zip.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={run_id}_data.zip"},
    )


# ── 6. Upload Video ─────────────────────────────────────────────────────────

@app.post("/internal/v1/test/upload")
async def upload_video(request: Request, filename: str = Query(...)):
    """
    Accepts raw video binary stream and saves to uploads/.
    Returns: { "videoPath": "..." }
    """
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_name = Path(filename).name
    dest_path = UPLOADS_DIR / f"{stamp}_{safe_name}"

    try:
        with open(dest_path, "wb") as f:
            async for chunk in request.stream():
                f.write(chunk)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    logger.info(f"Uploaded video saved to {dest_path} ({dest_path.stat().st_size} bytes)")
    return {"videoPath": str(dest_path)}


# ── 7. Start Analysis Run ───────────────────────────────────────────────────

def broadcast_event(run_id: str, event_data: dict[str, Any]):
    """Send event to all active SSE subscribers for this run and record in history."""
    if run_id not in run_history_events:
        run_history_events[run_id] = []
    run_history_events[run_id].append(event_data)

    queues = run_event_queues.get(run_id, [])
    for q in queues:
        try:
            q.put_nowait(event_data)
        except Exception:
            pass


async def run_pipeline_worker(run_id: str, video_path: str):
    """Background task executing main.py and streaming output line-by-line."""
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    log_file = run_dir / "run.log"

    cmd = [
        sys.executable,
        str(BASE_DIR / "main.py"),
        "--input",
        video_path,
        "--run-dir",
        str(run_dir),
    ]

    logger.info(f"Starting pipeline for run {run_id}: {' '.join(cmd)}")
    broadcast_event(run_id, {
        "type": "stage",
        "stage": "rallyclip",
        "message": "Khởi động mô hình AI phân tích Tennis-Vision...",
    })

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(BASE_DIR),
        )
        active_subprocesses[run_id] = proc

        with open(log_file, "a", encoding="utf-8") as lf:
            while True:
                line_bytes = await proc.stdout.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="replace").rstrip()
                lf.write(line + "\n")
                lf.flush()

                # Map log line to frontend stages
                stage = None
                if "[1/9]" in line:
                    stage = "rallyclip"
                    broadcast_event(run_id, {"type": "stage", "stage": stage, "message": "Nạp khung hình video..."})
                elif "[2/9]" in line:
                    stage = "court"
                    broadcast_event(run_id, {"type": "stage", "stage": stage, "message": "Nhận diện sân đấu và đường biên..."})
                elif "[3/9]" in line:
                    stage = "harsh"
                    broadcast_event(run_id, {"type": "stage", "stage": stage, "message": "Tracking vận động viên (YOLOv8x)..."})
                elif "[4/9]" in line:
                    stage = "good"
                    broadcast_event(run_id, {"type": "stage", "stage": stage, "message": "Tracking quỹ đạo bóng (TrackNetV3)..."})
                elif "[5/9]" in line or "[6/9]" in line:
                    stage = "rally"
                    broadcast_event(run_id, {"type": "stage", "stage": stage, "message": "Phân loại cú đánh & Hawkeye ELC..."})
                elif "[7/9]" in line or "[8/9]" in line:
                    stage = "rally"
                    broadcast_event(run_id, {"type": "stage", "stage": stage, "message": "Đo đạc chiến thuật và tái tạo 3D..."})
                elif "[9/9]" in line:
                    stage = "merge"
                    broadcast_event(run_id, {"type": "stage", "stage": stage, "message": "Xuất video H.264 và dữ liệu AR..."})

                broadcast_event(run_id, {
                    "type": "log",
                    "text": line,
                    "stage": stage,
                })

        returncode = await proc.wait()
        active_subprocesses.pop(run_id, None)

        if returncode == 0:
            logger.info(f"Run {run_id} completed successfully")
            meta_path = run_dir / "meta.json"
            meta = {}
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except Exception:
                    pass
            meta["status"] = "COMPLETED"
            meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

            broadcast_event(run_id, {
                "type": "stage",
                "stage": "completed",
                "message": "Hoàn tất phân tích video!",
            })
            broadcast_event(run_id, {
                "type": "done",
                "status": "COMPLETED",
                "files": get_run_files(run_dir),
            })
        else:
            logger.error(f"Run {run_id} failed with exit code {returncode}")
            meta_path = run_dir / "meta.json"
            meta = {"status": "FAILED", "exit_code": returncode}
            meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

            broadcast_event(run_id, {
                "type": "done",
                "status": "FAILED",
                "error": {"code": "PROCESS_EXIT_ERROR", "message": f"Pipeline dừng với mã lỗi {returncode}"},
            })

    except asyncio.CancelledError:
        logger.info(f"Run {run_id} was cancelled")
        if run_id in active_subprocesses:
            try:
                active_subprocesses[run_id].terminate()
            except Exception:
                pass
            active_subprocesses.pop(run_id, None)
        broadcast_event(run_id, {
            "type": "done",
            "status": "CANCELLED",
            "message": "Đã hủy phân tích",
        })
    except Exception as exc:
        logger.exception(f"Unexpected error in run {run_id}: {exc}")
        broadcast_event(run_id, {
            "type": "done",
            "status": "FAILED",
            "error": {"code": "EXCEPTION", "message": str(exc)},
        })


@app.post("/internal/v1/test/start")
async def start_run(payload: dict[str, Any]):
    """
    Start analysis on an uploaded video.
    Payload: { videoPath: string, keepDebugArtifacts?: boolean }
    Returns: { runId: string }
    """
    video_path = payload.get("videoPath")
    if not video_path or not Path(video_path).exists():
        raise HTTPException(status_code=400, detail=f"Video file not found at: {video_path}")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_id = f"run_{stamp}"
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    meta = {
        "runId": run_id,
        "status": "RUNNING",
        "videoPath": str(video_path),
        "started_at": datetime.now().isoformat(),
        "files": [],
        "hasVideo": False,
        "videoVerified": True,
    }
    (run_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    task = asyncio.create_task(run_pipeline_worker(run_id, str(video_path)))
    active_tasks[run_id] = task

    return {"runId": run_id}


# ── 8. Server-Sent Events (SSE) ─────────────────────────────────────────────

@app.get("/internal/v1/test/events")
async def get_run_events(request: Request, runId: str = Query(...)):
    """
    SSE stream yielding real-time progress events for a run.
    """
    run_dir = RUNS_DIR / runId
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail=f"Run '{runId}' not found")

    queue = asyncio.Queue()
    if runId not in run_event_queues:
        run_event_queues[runId] = []
    run_event_queues[runId].append(queue)

    async def event_generator() -> AsyncGenerator[dict[str, str], None]:
        try:
            # 1. Replay historical events
            for prev_ev in run_history_events.get(runId, []):
                yield {"data": json.dumps(prev_ev)}

            # If already finished and no events were buffered
            meta_path = run_dir / "meta.json"
            if meta_path.exists() and runId not in active_tasks:
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    if meta.get("status") == "COMPLETED":
                        yield {
                            "data": json.dumps({
                                "type": "done",
                                "status": "COMPLETED",
                                "files": get_run_files(run_dir),
                            })
                        }
                        return
                except Exception:
                    pass

            # 2. Stream live events
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=3.0)
                    yield {"data": json.dumps(event)}
                    if event.get("type") == "done":
                        break
                except asyncio.TimeoutError:
                    # Heartbeat comment to keep HTTP connection alive
                    yield {"comment": "keepalive"}
        finally:
            if runId in run_event_queues and queue in run_event_queues[runId]:
                run_event_queues[runId].remove(queue)

    return EventSourceResponse(event_generator())


# ── 9. Cancel Run ───────────────────────────────────────────────────────────

@app.post("/internal/v1/test/cancel/{run_id}")
async def cancel_run(run_id: str):
    """Cancel an ongoing run."""
    if run_id in active_tasks:
        active_tasks[run_id].cancel()
        active_tasks.pop(run_id, None)

    if run_id in active_subprocesses:
        try:
            active_subprocesses[run_id].terminate()
        except Exception:
            pass
        active_subprocesses.pop(run_id, None)

    run_dir = RUNS_DIR / run_id
    if run_dir.exists():
        meta_path = run_dir / "meta.json"
        meta = {"status": "CANCELLED"}
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return {"status": "CANCELLED"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 4200))
    host = os.environ.get("HOST", "0.0.0.0")
    logger.info(f"Starting Tennis-Vision Engine server on {host}:{port}")
    uvicorn.run("engine_server:app", host=host, port=port, reload=False)
