import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTelemetry } from '../api/TelemetryContext';
import { fetchArData, ArData, ArCourtSegment } from '../api/engine';

interface Props {
  videoUrl: string;
  showCourt?: boolean;
  showTrail?: boolean;
  showPlayers?: boolean;
  showKitchen?: boolean;
  /** Cho phép component cha điều khiển/đọc thời gian video thật. */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /** Gọi khi video lỗi (404, nguồn mất, decode sai...). */
  onError?: () => void;
}

const LINE_COLORS: Record<string, string> = {
  baselines: '#4cd7f6',
  sidelines: '#4cd7f6',
  singles: '#4cd7f6',
  kitchen: '#caf300',
  center: '#f472b6',
  net: '#ffffff',
  outline: '#8f9bb3',
};

const PLAYER_COLORS = ['#4cd7f6', '#f472b6'];
const TRAIL_WINDOW_MS = 900;

function interpolateLines(
  linesA: Record<string, number[][][]>,
  linesB: Record<string, number[][][]>,
  alpha: number
): Record<string, number[][][]> {
  const result: Record<string, number[][][]> = {};
  for (const [group, groupA] of Object.entries(linesA)) {
    const groupB = linesB[group];
    if (!groupB || groupA.length !== groupB.length) {
      result[group] = groupA;
      continue;
    }
    result[group] = groupA.map((lineA, lineIdx) => {
      const lineB = groupB[lineIdx];
      if (!lineB || lineA.length !== lineB.length) return lineA;
      return lineA.map((ptA, ptIdx) => {
        const ptB = lineB[ptIdx];
        if (!ptB) return ptA;
        return [
          ptA[0] + alpha * (ptB[0] - ptA[0]),
          ptA[1] + alpha * (ptB[1] - ptA[1]),
        ];
      });
    });
  }
  return result;
}

function getActiveCourtLines(seg: ArCourtSegment, tMs: number): Record<string, number[][][]> {
  const keyframes = seg.keyframes;
  if (!keyframes || keyframes.length === 0) {
    return seg.lines;
  }
  if (tMs <= keyframes[0].tMs) {
    return keyframes[0].lines;
  }
  const lastKf = keyframes[keyframes.length - 1];
  if (tMs >= lastKf.tMs) {
    return lastKf.lines;
  }

  let low = 0;
  let high = keyframes.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (keyframes[mid].tMs <= tMs) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const kf1 = keyframes[high];
  const kf2 = keyframes[low];
  if (!kf1 || !kf2) {
    return (kf1 ?? kf2)?.lines ?? seg.lines;
  }
  const span = kf2.tMs - kf1.tMs;
  if (span <= 0) return kf1.lines;
  const alpha = Math.max(0, Math.min(1, (tMs - kf1.tMs) / span));
  return interpolateLines(kf1.lines, kf2.lines, alpha);
}

/**
 * Video thật + lớp canvas overlay (sân / quỹ đạo bóng / chân VĐV)
 * tự nạp ar-data theo run hiện tại và vẽ theo video.currentTime.
 */
export const ArVideoLayer: React.FC<Props> = ({
  videoUrl,
  showCourt = false,
  showTrail = false,
  showPlayers = false,
  showKitchen = false,
  videoRef: externalVideoRef,
  onError,
}) => {
  const { runId } = useTelemetry();
  const [arData, setArData] = useState<ArData | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    setArData(null);
    if (!runId) return;
    let cancelled = false;
    fetchArData(runId)
      .then((d) => {
        if (!cancelled) setArData(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const segments = useMemo(() => arData?.court?.segments ?? [], [arData]);
  const trail = useMemo(() => arData?.ball?.trail ?? [], [arData]);
  const shots = useMemo(() => arData?.ball?.shots ?? [], [arData]);
  const playerSamples = useMemo(() => arData?.players?.samples ?? [], [arData]);

  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!arData) return;

    const tMs = video.currentTime * 1000;
    const seg = segments.find((s) => tMs >= s.startMs && tMs <= s.endMs) ?? null;
    // Worker chấm điểm homography trên từng frame của pha và trả validWindows:
    // khi camera cắt cận cảnh VĐV, sân không còn trên khung — ẩn overlay sân
    // thay vì vẽ trôi nổi. Trail/chân VĐV vẫn vẽ vì đó là detection theo frame.
    // Worker chấm điểm homography trên từng frame của pha và trả validWindows:
    // khi camera cắt cận cảnh VĐV, sân không còn trên khung — ẩn overlay sân.
    // Áp dụng độ mờ mềm mại (fade-in / fade-out trong 300ms) để không bị giật nhấp nháy.
    let courtAlpha = 0;
    if (showCourt && seg?.lines) {
      if (!seg.validWindows?.length) {
        courtAlpha = 1;
      } else {
        for (const [a, b] of seg.validWindows) {
          if (tMs >= a - 100 && tMs <= b + 100) {
            const inAlpha = Math.min(1, Math.max(0, (tMs - a + 100) / 300));
            const outAlpha = Math.min(1, Math.max(0, (b + 100 - tMs) / 300));
            courtAlpha = Math.max(courtAlpha, Math.min(inAlpha, outAlpha));
          }
        }
      }
    }

    // Canvas cố định 1280×720 bị CSS kéo giãn theo khung, còn <video> dùng
    // object-contain (letterbox khi tỉ lệ khung ≠ 16:9). Phải tính đúng hình
    // chữ nhật mà video đang chiếm chỗ, nếu không overlay sẽ lệch/sai tỉ lệ
    // so với sân thật trong video (lệch sân khi video 4:3 hoặc dọc).
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    let dx = 0;
    let dy = 0;
    let dw = w;
    let dh = h;
    if (vw > 0 && vh > 0) {
      const scale = Math.min(w / vw, h / vh);
      dw = vw * scale;
      dh = vh * scale;
      dx = (w - dw) / 2;
      dy = (h - dh) / 2;
    }
    const px = (u: number) => dx + u * dw;
    const py = (v: number) => dy + v * dh;

    // 1) Đường sân — mỗi group là danh sách polyline và MỘT polyline có thể có
    // nhiều hơn 2 điểm (vd "outline" là quad 4 góc sân khép kín 5 điểm).
    // Phải nối tất cả các đỉnh liên tiếp, không chỉ 2 điểm đầu — trước đây
    // khung 4 góc sân chỉ vẽ được duy nhất cạnh trên.
    if (showCourt && seg?.lines && courtAlpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = courtAlpha;
      ctx.lineWidth = 2;
      const activeLines = getActiveCourtLines(seg, tMs);
      for (const [group, lines] of Object.entries(activeLines)) {
        if (!showKitchen && (group === 'kitchen' || group === 'center')) {
          continue;
        }
        ctx.strokeStyle = LINE_COLORS[group] ?? '#8f9bb3';
        for (const line of lines ?? []) {
          if (!Array.isArray(line) || line.length < 2) continue;
          ctx.beginPath();
          let started = false;
          for (const p of line) {
            if (!Array.isArray(p) || p.length < 2) continue;
            const x = px(p[0]);
            const y = py(p[1]);
            if (!started) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
          }
          if (started) ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 2) Chân & Bounding Box 2 VĐV (sample gần nhất ≤ tMs, cửa sổ 0.5s)
    if (showPlayers && playerSamples.length > 0) {
      let sample = null as (typeof playerSamples)[number] | null;
      for (let i = playerSamples.length - 1; i >= 0; i--) {
        if (playerSamples[i].t <= tMs) {
          if (tMs - playerSamples[i].t <= 500) sample = playerSamples[i];
          break;
        }
      }
      if (sample) {
        for (let idx = 0; idx < 2; idx++) {
          const uv = sample.feet?.[idx];
          if (!uv) continue;
          const x = px(uv[0]);
          const y = py(uv[1]);

          // Điểm tiếp đất chân & vòng tròn định vị
          ctx.strokeStyle = PLAYER_COLORS[idx];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 12, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = PLAYER_COLORS[idx];
          ctx.beginPath();
          ctx.arc(x, y, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;

          // Bounding Box HUD: khung nhận diện quanh VĐV
          const pUv = sample.p?.[idx];
          const centerY = pUv ? py(pUv[1]) : y - 35;
          const boxH = Math.max(50, Math.abs(y - centerY) * 2.2);
          const boxW = Math.max(28, boxH * 0.45);
          const topY = y - boxH;
          const leftX = x - boxW / 2;
          const cLen = Math.min(8, boxW * 0.3);

          ctx.save();
          ctx.strokeStyle = PLAYER_COLORS[idx];
          ctx.lineWidth = 1.5;
          // Góc trên-trái
          ctx.beginPath();
          ctx.moveTo(leftX, topY + cLen);
          ctx.lineTo(leftX, topY);
          ctx.lineTo(leftX + cLen, topY);
          // Góc trên-phải
          ctx.moveTo(leftX + boxW - cLen, topY);
          ctx.lineTo(leftX + boxW, topY);
          ctx.lineTo(leftX + boxW, topY + cLen);
          // Góc dưới-trái
          ctx.moveTo(leftX, y - cLen);
          ctx.lineTo(leftX, y);
          ctx.lineTo(leftX + cLen, y);
          // Góc dưới-phải
          ctx.moveTo(leftX + boxW - cLen, y);
          ctx.lineTo(leftX + boxW, y);
          ctx.lineTo(leftX + boxW, y - cLen);
          ctx.stroke();

          // Nhãn tên VĐV
          ctx.font = 'bold 11px ui-monospace, monospace';
          ctx.fillStyle = PLAYER_COLORS[idx];
          ctx.fillText(`P${idx + 1}`, leftX, topY - 4);
          ctx.restore();
        }
      }
    }

    // 3) Quỹ đạo bóng 0.9s gần nhất
    if (showTrail) {
      const recent = trail.filter((p) => p.t <= tMs && tMs - p.t <= TRAIL_WINDOW_MS);
      if (recent.length > 1) {
        for (let i = 1; i < recent.length; i++) {
          const p0 = recent[i - 1];
          const p1 = recent[i];
          const alpha = 1 - (tMs - p1.t) / TRAIL_WINDOW_MS;
          ctx.strokeStyle = `rgba(244, 114, 182, ${Math.max(0.15, alpha).toFixed(2)})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(px(p0.u), py(p0.v));
          ctx.lineTo(px(p1.u), py(p1.v));
          ctx.stroke();
        }
        const last = recent[recent.length - 1];
        ctx.fillStyle = '#f472b6';
        ctx.beginPath();
        ctx.arc(px(last.u), py(last.v), 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [arData, segments, showCourt, showTrail, showPlayers, showKitchen, trail, playerSamples]);

  useEffect(() => {
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <>
      <video
        ref={(el) => {
          videoRef.current = el;
          if (externalVideoRef) externalVideoRef.current = el;
        }}
        src={videoUrl}
        className="absolute inset-0 w-full h-full object-contain"
        playsInline
        controls
        onError={onError}
      />
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
    </>
  );
};
