import { useCallback, useRef, useState } from 'react';
import { cancelRun, startRun, uploadVideo } from './engine';

export interface RunEvent {
  type: string;
  timestamp?: string;
  stage?: string;
  message?: string;
  text?: string;
  status?: string;
  files?: string[];
  error?: { code: string; message: string };
}

export type RunPhase = 'idle' | 'uploading' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';

const MAX_LOG_LINES = 300;

export function useRunMonitor(onCompleted?: () => void) {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [uploadPct, setUploadPct] = useState(0);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [stage, setStage] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [clipPct, setClipPct] = useState(0); // % frame RallyClip đã chạy
  const [rallyDone, setRallyDone] = useState(0); // số pha đã xử lý xong
  const [rallyTotal, setRallyTotal] = useState(0); // tổng số pha
  const esRef = useRef<EventSource | null>(null);

  const pushLog = useCallback((line: string) => {
    setLogs((prev) => {
      const next = [...prev, line];
      return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
    });
  }, []);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    closeStream();
    setPhase('idle');
    setUploadPct(0);
    setStage('');
    setActiveRunId(null);
    setError(null);
    setLogs([]);
    setStartTime(null);
    setClipPct(0);
    setRallyDone(0);
    setRallyTotal(0);
  }, [closeStream]);

  const start = useCallback(
    (file: File) => {
      if (phase === 'uploading' || phase === 'starting' || phase === 'running') return;
      cleanup();
      setPhase('uploading');
      setStartTime(Date.now());
      pushLog(`▲ Đang tải video lên engine: ${file.name}...`);

      uploadVideo(file, setUploadPct)
        .then((videoPath) => {
          if (!videoPath) throw new Error('Upload không trả về đường dẫn video');
          setPhase('starting');
          pushLog('✓ Tải lên xong — khởi tạo phân tích...');
          return startRun(videoPath);
        })
        .then((runId) => {
          setActiveRunId(runId);
          setPhase('running');
          pushLog(`▶ Run ${runId} đã bắt đầu — nhận tiến trình trực tiếp (SSE)...`);

          const es = new EventSource(`/internal/v1/test/events?runId=${encodeURIComponent(runId)}`);
          esRef.current = es;
          es.onmessage = (ev) => {
            let data: RunEvent;
            try {
              data = JSON.parse(ev.data) as RunEvent;
            } catch {
              return;
            }
            if (data.type === 'stage' && data.stage) {
              setStage(data.stage);
              if (data.stage === 'rallyclip') {
                // Bắt đầu vòng mới: reset bộ đếm tiến trình.
                setClipPct(0);
                setRallyDone(0);
                setRallyTotal(0);
              }
              pushLog(`◆ ${data.message ?? data.stage}`);
            } else if (data.type === 'log' && data.text) {
              const raw = data.text;
              // Tiến trình RallyClip: "Processing frames:  77%|..."
              const clip = raw.match(/Processing frames:\s+(\d{1,3})%/);
              if (clip) setClipPct(Math.min(100, parseInt(clip[1], 10)));
              // Bắt đầu pha: "--- Đang xử lý pha 5/16 (...) ---"
              const piece = raw.match(/Đang xử lý pha (\d+)\/(\d+)/);
              if (piece) {
                setRallyDone(parseInt(piece[1], 10) - 1);
                setRallyTotal(parseInt(piece[2], 10));
              }
              // Pha xong/bỏ qua/lỗi → đã xử lý xong pha N, chuyển pha kế.
              const pieceEnd = raw.match(/\[Pha (\d+)\] (?:Hoàn tất đo pha|Bỏ qua pha|Lỗi:)/);
              if (pieceEnd) setRallyDone(parseInt(pieceEnd[1], 10));
              // Log events cũng mang stage (rallyclip/harsh/good/rally/merge) —
              // dùng để cập nhật nhãn tiến trình mượt hơn.
              if (data.stage) setStage(data.stage);
              const text = raw.replace(/\r/g, '\n').split('\n').filter(Boolean);
              if (text.length > 1) {
                // Dòng progress bar dạng tràn (\r): chỉ giữ dòng cuối.
                pushLog(text[text.length - 1]);
              } else {
                pushLog(text[0]);
              }
            } else if (data.type === 'done') {
              closeStream();
              if (data.status === 'COMPLETED') {
                setPhase('completed');
                setStage('');
                pushLog('✓ Phân tích hoàn tất! Kết quả đã sẵn sàng.');
                onCompleted?.();
              } else {
                setPhase(data.status === 'CANCELLED' ? 'cancelled' : 'failed');
                setError(data.error?.message ?? data.status ?? 'Lỗi không xác định');
                pushLog(`✗ Kết thúc: ${data.status} — ${data.error?.message ?? ''}`);
              }
            }
          };
          es.onerror = async () => {
            closeStream();
            try {
              const res = await fetch('/internal/v1/test/runs');
              if (res.ok) {
                const data = await res.json();
                const matched = (data.runs || []).find((r: { runId: string; status: string }) => r.runId === runId);
                if (matched?.status === 'COMPLETED') {
                  setPhase('completed');
                  setStage('');
                  pushLog('✓ Phân tích hoàn tất! Kết quả đã sẵn sàng.');
                  onCompleted?.();
                  return;
                }
              }
            } catch {
              // ignore
            }
            // BE giữ kết nối bằng heartbeat; lỗi ở đây thường là run đã kết thúc
            // hoặc mất kết nối — nếu chưa nhận 'done' thì đánh dấu failed.
            setPhase((cur) => (cur === 'running' ? 'failed' : cur));
            setError((cur) => cur ?? 'Mất kết nối sự kiện với engine');
          };
        })
        .catch((err: Error) => {
          setPhase('failed');
          setError(err.message);
          pushLog(`✗ Lỗi: ${err.message}`);
        });
    },
    [phase, cleanup, pushLog, closeStream, onCompleted]
  );

  const cancel = useCallback(() => {
    if (activeRunId) {
      cancelRun(activeRunId).catch(() => undefined);
      pushLog('■ Đã gửi yêu cầu hủy...');
    }
  }, [activeRunId, pushLog]);

  // Ước lượng % tiến trình phân tích (sau upload):
  // RallyClip chiếm ~20% đầu, xử lý từng pha ~75%, merge ~5% cuối.
  const inClipPhase = stage === 'rallyclip' || (clipPct > 0 && rallyTotal === 0 && !stage.startsWith('merge'));
  let analysisPct = 1;
  if (stage === 'merge' || stage === 'completed') {
    analysisPct = 96;
  } else if (rallyTotal > 0 && !inClipPhase) {
    analysisPct = 20 + Math.round((Math.min(rallyDone, rallyTotal) / rallyTotal) * 75);
  } else if (inClipPhase) {
    analysisPct = Math.max(1, Math.round(clipPct * 0.2));
  } else if (stage && stage !== 'init') {
    analysisPct = 25; // harsh/good pha đầu, chưa biết tổng số pha
  }

  return {
    phase,
    uploadPct,
    activeRunId,
    stage,
    logs,
    error,
    startTime,
    analysisPct,
    rallyDone,
    rallyTotal,
    start,
    cancel,
    reset: cleanup,
  };
}
