import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTelemetry } from '../api/TelemetryContext';
import { fetchArData, ArData, ArCourtSegment } from '../api/engine';

interface Props {
  videoUrl: string;
  rallyId?: number;
  showCourt?: boolean;
  showTrail?: boolean;
  showPlayers?: boolean;
  showKitchen?: boolean;
  showBounces?: boolean;
  showFullTrajectory?: boolean;
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
const TRAIL_WINDOW_MS = 1000;

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
 * Video thật + lớp canvas overlay AR:
 * - Vạch sân tennis quang học chuẩn homography
 * - Quỹ đạo bóng AR (Real-time tail + Full Rally Arc)
 * - Điểm nảy sân (Hawkeye Bounces với ripple hiệu ứng)
 * - Điểm tiếp xúc vợt (Shots)
 * - Bounding box và vị trí chân VĐV
 */
export const ArVideoLayer: React.FC<Props> = ({
  videoUrl,
  rallyId,
  showCourt = true,
  showTrail = true,
  showPlayers = true,
  showKitchen = true,
  showBounces = true,
  showFullTrajectory = false,
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
    fetchArData(runId, rallyId)
      .then((d) => {
        if (!cancelled) setArData(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runId, rallyId]);

  const segments = useMemo(() => arData?.court?.segments ?? [], [arData]);
  const trail = useMemo(() => arData?.ball?.trail ?? [], [arData]);
  const shots = useMemo(() => arData?.ball?.shots ?? [], [arData]);
  const bounces = useMemo(() => arData?.ball?.bounces ?? [], [arData]);
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

    // Fade-in / fade-out court overlay
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

    // Tỉ lệ letterbox của video
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

    // 1) Đường sân quang học AR
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

    // 2) Chân & Bounding Box 2 VĐV
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

    // 3) Điểm nảy sân (Hawkeye Bounces với ripple lan tỏa)
    if (showBounces && bounces.length > 0) {
      for (const b of bounces) {
        // Hiển thị điểm nảy trong 2.5s sau khi nảy (hoặc toàn bộ nếu showFullTrajectory)
        const isRecent = tMs >= b.t && tMs - b.t <= 2500;
        const isHistory = showFullTrajectory && tMs >= b.t;

        if (isRecent || isHistory) {
          const bx = px(b.u);
          const by = py(b.v);
          const age = Math.min(1, Math.max(0, (tMs - b.t) / 2500));
          const rippleAlpha = isRecent ? Math.max(0.15, 1 - age) : 0.35;
          const rippleRadius = isRecent ? 8 + age * 20 : 10;

          ctx.save();
          // Tâm điểm nảy
          ctx.fillStyle = '#caf300';
          ctx.beginPath();
          ctx.arc(bx, by, 4.5, 0, Math.PI * 2);
          ctx.fill();

          // Vòng sóng ripple
          ctx.strokeStyle = `rgba(202, 243, 0, ${rippleAlpha.toFixed(2)})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(bx, by, rippleRadius, 0, Math.PI * 2);
          ctx.stroke();

          // Nhãn BOUNCE
          if (isRecent) {
            ctx.font = 'bold 9px ui-monospace, monospace';
            ctx.fillStyle = `rgba(202, 243, 0, ${rippleAlpha.toFixed(2)})`;
            ctx.fillText('● BOUNCE', bx - 20, by - rippleRadius - 3);
          }
          ctx.restore();
        }
      }
    }

    // 4) Điểm tiếp xúc vợt (Shots)
    if (shots.length > 0) {
      for (const s of shots) {
        if (tMs >= s.t && tMs - s.t <= 1200) {
          const sx = px(s.u);
          const sy = py(s.v);
          const age = (tMs - s.t) / 1200;
          const alpha = Math.max(0.2, 1 - age);

          ctx.save();
          ctx.fillStyle = `rgba(76, 215, 246, ${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(sx, sy, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = 'bold 9px ui-monospace, monospace';
          ctx.fillStyle = `rgba(76, 215, 246, ${alpha.toFixed(2)})`;
          ctx.fillText('⚡ HIT', sx - 12, sy - 8);
          ctx.restore();
        }
      }
    }

    // 5) Quỹ đạo bóng AR
    if (showTrail && trail.length > 0) {
      // 5a. Toàn bộ đường bay lịch sử của pha (khi bật showFullTrajectory)
      if (showFullTrajectory) {
        const past = trail.filter((p) => p.t <= tMs);
        if (past.length > 1) {
          ctx.save();
          ctx.strokeStyle = 'rgba(76, 215, 246, 0.4)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          let inPath = false;
          for (let i = 1; i < past.length; i++) {
            const p0 = past[i - 1];
            const p1 = past[i];
            const dt = p1.t - p0.t;
            const dist = Math.hypot(p1.u - p0.u, p1.v - p0.v);
            // Ngắt nét nếu khoảng cách thời gian gián đoạn > 150ms hoặc nhảy vọt phi lý (> 8% màn hình / 40ms)
            if (dt > 150 || (dt > 0 && dist / (dt / 40) > 0.08)) {
              inPath = false;
              continue;
            }
            if (!inPath) {
              ctx.moveTo(px(p0.u), py(p0.v));
              inPath = true;
            }
            ctx.lineTo(px(p1.u), py(p1.v));
          }
          ctx.stroke();
          ctx.restore();
        }
      }

      // 5b. Đuôi quỹ đạo thực tế 1.0s gần nhất (luminous neon arc)
      const recent = trail.filter((p) => p.t <= tMs && tMs - p.t <= TRAIL_WINDOW_MS);
      if (recent.length > 1) {
        ctx.save();
        for (let i = 1; i < recent.length; i++) {
          const p0 = recent[i - 1];
          const p1 = recent[i];
          const dt = p1.t - p0.t;
          const dist = Math.hypot(p1.u - p0.u, p1.v - p0.v);
          // Ngắt đoạn vẽ nếu thời gian gián đoạn > 150ms hoặc vận tốc phi lý (> 8% màn hình / 40ms)
          if (dt > 150 || (dt > 0 && dist / (dt / 40) > 0.08)) {
            continue;
          }
          const alpha = 1 - (tMs - p1.t) / TRAIL_WINDOW_MS;
          // Gradient từ hồng cánh sen đến vàng chanh neon
          ctx.strokeStyle = `rgba(202, 243, 0, ${Math.max(0.2, alpha).toFixed(2)})`;
          ctx.lineWidth = 2.5 + alpha * 1.5;
          ctx.beginPath();
          ctx.moveTo(px(p0.u), py(p0.v));
          ctx.lineTo(px(p1.u), py(p1.v));
          ctx.stroke();
        }

        // Đầu quả bóng hiện tại đang bay: quả cầu phát sáng
        const last = recent[recent.length - 1];
        const lx = px(last.u);
        const ly = py(last.v);

        // Glow tỏa sáng
        ctx.shadowColor = '#caf300';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#caf300';
        ctx.beginPath();
        ctx.arc(lx, ly, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Vòng viền trắng tăng độ tương phản
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(lx, ly, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [
    arData,
    segments,
    showCourt,
    showTrail,
    showPlayers,
    showKitchen,
    showBounces,
    showFullTrajectory,
    trail,
    shots,
    bounces,
    playerSamples,
  ]);

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
