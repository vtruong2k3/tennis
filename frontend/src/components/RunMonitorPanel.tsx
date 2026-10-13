import React, { useEffect, useRef, useState } from 'react';
import { Upload, XCircle, ChevronDown, ChevronUp, Loader2, CheckCircle2, AlertTriangle, BarChart3, Download } from 'lucide-react';
import { RunPhase } from '../api/useRunMonitor';

interface RunMonitorPanelProps {
  phase: RunPhase;
  uploadPct: number;
  activeRunId: string | null;
  stage: string;
  logs: string[];
  error: string | null;
  startTime: number | null;
  analysisPct: number;
  rallyDone: number;
  rallyTotal: number;
  onStart: (file: File) => void;
  onCancel: () => void;
  onReset: () => void;
  onGoToResults?: () => void;
  /** Run gần nhất có kết quả để tải dữ liệu (run vừa xong hoặc run đang chọn). */
  downloadRunId?: string | null;
}

const PHASE_LABEL: Record<RunPhase, string> = {
  idle: 'Sẵn sàng',
  uploading: 'Đang tải video lên',
  starting: 'Đang khởi tạo run',
  running: 'Đang phân tích',
  completed: 'Hoàn tất',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
};

const STAGE_LABEL: Record<string, string> = {
  init: 'Khởi tạo',
  rallyclip: 'RallyClip — tách pha bóng',
  rally: 'Xử lý từng pha',
  harsh: 'HarshTomar — tốc độ & loại cú đánh',
  good: 'Good-Tennis — toạ độ sân & AR',
  merge: 'Hợp nhất kết quả',
  completed: 'Hoàn tất',
  error: 'Lỗi',
  timeout: 'Hết giờ',
  cancelled: 'Đã hủy',
};

const ACTIVE = new Set<RunPhase>(['uploading', 'starting', 'running']);

export const RunMonitorPanel: React.FC<RunMonitorPanelProps> = ({
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
  onStart,
  onCancel,
  onReset,
  onGoToResults,
  downloadRunId,
}) => {
  const [dragOver, setDragOver] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const running = ACTIVE.has(phase);

  useEffect(() => {
    if (!startTime || !running) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startTime, running]);

  useEffect(() => {
    logBoxRef.current?.scrollTo({ top: logBoxRef.current.scrollHeight });
  }, [logs]);

  const pickFile = () => fileInputRef.current?.click();

  const onFile = (file: File | undefined | null) => {
    if (file) onStart(file);
  };

  // Upload dùng % file; phân tích dùng % ước lượng theo stage + pha; pha không xác định thì thanh chạy vô hạn cảm giác.
  const progressPct =
    phase === 'uploading' ? uploadPct : phase === 'running' || phase === 'starting' ? Math.max(4, analysisPct) : 0;

  const stageText =
    phase === 'uploading'
      ? `Đang tải video lên: ${uploadPct}%`
      : phase === 'starting'
        ? 'Đang khởi tạo run...'
        : rallyTotal > 0
          ? `Pha ${Math.min(rallyDone, rallyTotal)}/${rallyTotal} — ${analysisPct}% ước tính`
          : stage
            ? `${STAGE_LABEL[stage] ?? stage} — ${analysisPct}% ước tính`
            : `Đang phân tích — ${analysisPct}% ước tính`;

  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="bg-[#111624] border border-white/10 rounded-xl shadow-lg overflow-hidden">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center border ${
              phase === 'completed'
                ? 'bg-[#caf300]/10 border-[#caf300]/40 text-[#caf300]'
                : phase === 'failed' || phase === 'cancelled'
                  ? 'bg-[#f472b6]/10 border-[#f472b6]/40 text-[#f472b6]'
                  : running
                    ? 'bg-[#4cd7f6]/10 border-[#4cd7f6]/40 text-[#4cd7f6]'
                    : 'bg-white/5 border-white/10 text-[#8f9bb3]'
            }`}
          >
            {phase === 'completed' ? (
              <CheckCircle2 className="w-4.5 h-4.5" />
            ) : phase === 'failed' || phase === 'cancelled' ? (
              <AlertTriangle className="w-4.5 h-4.5" />
            ) : running ? (
              <Loader2 className="w-4.5 h-4.5 animate-spin" />
            ) : (
              <Upload className="w-4.5 h-4.5" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-white font-bold text-sm">Chạy phân tích mới</h3>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                  running
                    ? 'bg-[#4cd7f6]/10 border-[#4cd7f6]/30 text-[#4cd7f6] animate-pulse'
                    : phase === 'completed'
                      ? 'bg-[#caf300]/10 border-[#caf300]/30 text-[#caf300]'
                      : 'bg-white/5 border-white/10 text-[#8f9bb3]'
                }`}
              >
                {PHASE_LABEL[phase].toUpperCase()}
                {running && elapsed > 0 ? ` · ${mmss(elapsed)}` : ''}
              </span>
            </div>
            <p className="text-[11px] font-mono text-[#8f9bb3] mt-0.5">
              {running
                ? `${STAGE_LABEL[stage] ?? stage ?? 'Đang xử lý'}${activeRunId ? ` — ${activeRunId}` : ''}`
                : phase === 'completed'
                  ? `Run ${activeRunId ?? ''} xong — nhấn ↻ trên dropdown để chọn run mới`
                  : 'Tải lên video tennis (≥ 20 giây) để phân tích bằng engine thật'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {running ? (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#f472b6]/10 border border-[#f472b6]/40 text-[#f472b6] text-xs font-bold hover:bg-[#f472b6]/20 transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" /> HỦY
            </button>
          ) : (
            <>
              {phase === 'completed' && onGoToResults && (
                <button
                  onClick={onGoToResults}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#4cd7f6]/10 border border-[#4cd7f6]/40 text-[#4cd7f6] text-xs font-bold hover:bg-[#4cd7f6]/20 transition-colors"
                >
                  <BarChart3 className="w-3.5 h-3.5" /> XEM KẾT QUẢ →
                </button>
              )}
              {downloadRunId && (
                <a
                  href={`/internal/v1/test/runs/${encodeURIComponent(downloadRunId)}/data.zip`}
                  download={`${downloadRunId}_data.zip`}
                  title={`Tải toàn bộ dữ liệu phân tích của run ${downloadRunId} (5 file JSON + run.log)`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#caf300]/10 border border-[#caf300]/40 text-[#caf300] text-xs font-bold hover:bg-[#caf300]/20 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" /> TẢI DỮ LIỆU
                </a>
              )}
              <button
                onClick={pickFile}
                disabled={phase === 'uploading'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#caf300] text-black text-xs font-bold hover:brightness-110 disabled:opacity-50 transition-all"
              >
                <Upload className="w-3.5 h-3.5" /> CHỌN VIDEO & CHẠY
              </button>
              {(phase === 'completed' || phase === 'failed' || phase === 'cancelled') && (
                <button
                  onClick={onReset}
                  className="px-3 py-1.5 rounded border border-white/15 text-[#8f9bb3] text-xs font-semibold hover:text-white hover:border-white/30 transition-colors"
                >
                  Xoá
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded border border-white/10 text-[#8f9bb3] hover:text-white transition-colors"
            title={expanded ? 'Thu gọn log' : 'Mở log'}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/*"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* Progress bar */}
      {running && (
        <div className="px-5 pb-3">
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                phase === 'uploading' ? 'bg-[#f472b6]' : 'bg-gradient-to-r from-[#4cd7f6] to-[#caf300] animate-pulse'
              }`}
              style={{ width: `${Math.max(4, progressPct)}%` }}
            />
          </div>
          <p className="text-[10px] font-mono text-[#8f9bb3] mt-1">{stageText}</p>
        </div>
      )}

      {error && !running && (
        <div className="mx-5 mb-3 px-3 py-2 rounded bg-[#f472b6]/10 border border-[#f472b6]/30 text-[#f472b6] text-xs font-mono">
          {error}
        </div>
      )}

      {/* Drop zone (khi idle) + Live log */}
      {expanded && (
        <div className="px-5 pb-5">
          {!running && phase === 'idle' && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                onFile(e.dataTransfer.files?.[0]);
              }}
              onClick={pickFile}
              className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
                dragOver ? 'border-[#caf300] bg-[#caf300]/5' : 'border-white/10 hover:border-[#4cd7f6]/50'
              }`}
            >
              <Upload className="w-6 h-6 mx-auto text-[#8f9bb3] mb-2" />
              <p className="text-xs text-[#dfe2f1] font-semibold">Kéo thả video vào đây hoặc bấm để chọn file</p>
              <p className="text-[10px] font-mono text-[#64748b] mt-1">MP4 · sẽ chạy qua RallyClip → HarshTomar → Good-Tennis</p>
            </div>
          )}

          {logs.length > 0 && (
            <div
              ref={logBoxRef}
              className="mt-3 rounded-lg bg-[#0a0e17] border border-white/10 px-3 py-2.5 h-[640px] overflow-y-auto font-mono text-[10.5px] leading-relaxed text-[#a0aec0]"
            >
              {logs.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith('✓')
                      ? 'text-[#caf300]'
                      : line.startsWith('✗') || line.startsWith('■')
                        ? 'text-[#f472b6]'
                        : line.startsWith('◆') || line.startsWith('▶') || line.startsWith('▲')
                          ? 'text-[#4cd7f6]'
                          : ''
                  }
                >
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
