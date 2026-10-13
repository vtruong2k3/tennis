import React, { useEffect, useMemo, useState } from 'react';
import { ArData, ArPlayerSample } from '../api/engine';
import { HeatmapData } from '../api/useArData';
import {
  COURT_LENGTH_M,
  COURT_WIDTH_M,
  SINGLES_INSET_M,
  SERVICE_FROM_NET_M,
  cornersFromSegment,
  courtHomographyFromImage,
  buildCourtView,
  heatRampColor,
} from '../api/courtMap';

const P1_COLOR = '#4cd7f6';
const P2_COLOR = '#caf300';
const BALL_COLOR = '#caf300';

// Bố cục SVG: sân thật chiếu vào khung này.
const VW = 540;
const VH = 300;
const BOX = { x: 70, y: 25, w: 400, hgt: 250 };

// Sân phải giữ đúng tỉ lệ thật 23.77 × 10.97 m — fit vào BOX (canh giữa)
// thay vì phủ kín BOX (trước đây sân bị bóp ngang → vẽ sai kích thước).
const COURT_SCALE = Math.min(BOX.w / COURT_LENGTH_M, BOX.hgt / COURT_WIDTH_M);
const COURT_BOX = {
  x: BOX.x + (BOX.w - COURT_LENGTH_M * COURT_SCALE) / 2,
  y: BOX.y + (BOX.hgt - COURT_WIDTH_M * COURT_SCALE) / 2,
  w: COURT_LENGTH_M * COURT_SCALE,
  hgt: COURT_WIDTH_M * COURT_SCALE,
};

interface SvgPoint {
  t: number;
  x: number;
  y: number;
}

// Điểm cuối cùng có t <= tSeek (trail đã sắp theo t).
function pointAt(points: SvgPoint[], t: number): SvgPoint | null {
  if (points.length === 0) return null;
  let idx = 0;
  while (idx + 1 < points.length && points[idx + 1].t <= t) idx++;
  return points[idx];
}

// Mẫu vị trí VĐV gần mốc thời gian nhất (trong cửa sổ cho phép).
function nearestSample(samples: ArPlayerSample[], t: number, windowMs = 600): ArPlayerSample | null {
  let best: ArPlayerSample | null = null;
  let bestDt = Infinity;
  for (const s of samples) {
    const dt = Math.abs(s.t - t);
    if (dt < bestDt) {
      bestDt = dt;
      best = s;
    }
  }
  return bestDt <= windowMs ? best : null;
}

interface CourtRealSvgProps {
  ar: ArData;
  heat: HeatmapData | null;
  rallyIndex: number;
  isPlaying: boolean;
  replayKey: number; // tăng lên để tua lại từ đầu
  showHeatmap: boolean;
  showTrail: boolean;
  showPlayers: boolean;
}

export const CourtRealSvg: React.FC<CourtRealSvgProps> = ({
  ar,
  heat,
  rallyIndex,
  isPlaying,
  replayKey,
  showHeatmap,
  showTrail,
  showPlayers,
}) => {
  const [progress, setProgress] = useState(0);

  const rally = ar.result?.rallies?.[rallyIndex] ?? null;

  // Segment court của rally: ưu tiên segment nằm trọn trong rally, rồi đến segment giao nhau.
  const seg = useMemo(() => {
    const segments = ar.court?.segments ?? [];
    if (!rally || segments.length === 0) return null;
    return (
      segments.find((s) => s.startMs >= rally.startMs - 50 && s.endMs <= rally.endMs + 50) ??
      segments.find((s) => s.startMs <= rally.endMs && s.endMs >= rally.startMs) ??
      segments[0]
    );
  }, [ar, rally?.startMs, rally?.endMs]);

  // Homography + bộ chiếu sân(mét) <-> SVG.
  const view = useMemo(() => {
    if (!seg) return null;
    const corners = cornersFromSegment(seg);
    if (!corners) return null;
    const h = courtHomographyFromImage(corners);
    if (!h) return null;
    return buildCourtView(h, { x: COURT_BOX.x, y: COURT_BOX.y, w: COURT_BOX.w, hgt: COURT_BOX.hgt });
  }, [seg]);

  // Quỹ đạo bóng trong rally: uv ảnh -> mét (homography) -> SVG.
  // Lọc theo biên sân (±2.5m): điểm chiếu ra ngoài quá xa = court detect sai
  // hoặc bóng ngoài vùng tin cậy — bỏ để không vẽ loạn lên card.
  const toSvg = (u: number, v: number): SvgPoint | null => {
    if (!view) return null;
    const c = view.inv(u, v);
    if (!c) return null;
    const m = 2.5;
    if (
      c.x < -m ||
      c.x > COURT_WIDTH_M + m ||
      c.y < -m ||
      c.y > COURT_LENGTH_M + m
    ) {
      return null;
    }
    const s = view.map(c.x, c.y);
    return { t: 0, x: s.x, y: s.y };
  };

  const trail = useMemo(() => {
    if (!rally || !view) return [] as SvgPoint[];
    return (ar.ball?.trail ?? [])
      .filter((p) => p.t >= rally.startMs && p.t <= rally.endMs)
      .map((p) => {
        const s = toSvg(p.u, p.v);
        return s ? { t: p.t, x: s.x, y: s.y } : null;
      })
      .filter((p): p is SvgPoint => p !== null);
  }, [ar, rally?.startMs, rally?.endMs, view]);

  const bounces = useMemo(() => {
    if (!rally || !view) return [] as SvgPoint[];
    return (ar.ball?.bounces ?? [])
      .filter((p) => p.t >= rally.startMs && p.t <= rally.endMs)
      .map((p) => {
        const s = toSvg(p.u, p.v);
        return s ? { t: p.t, x: s.x, y: s.y } : null;
      })
      .filter((p): p is SvgPoint => p !== null);
  }, [ar, rally?.startMs, rally?.endMs, view]);

  const shots = useMemo(() => {
    if (!rally || !view) return [] as SvgPoint[];
    return (ar.ball?.shots ?? [])
      .filter((p) => p.t >= rally.startMs && p.t <= rally.endMs)
      .map((p) => {
        const s = toSvg(p.u, p.v);
        return s ? { t: p.t, x: s.x, y: s.y } : null;
      })
      .filter((p): p is SvgPoint => p !== null);
  }, [ar, rally?.startMs, rally?.endMs, view]);

  // Vòng lặp animation: bóng chạy hết rally rồi nghỉ 0.7s, lặp lại.
  useEffect(() => {
    if (!isPlaying || trail.length < 2) return;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: number | null = null;
    const duration = 2400;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setProgress(p);
      if (p < 1) {
        raf = requestAnimationFrame(step);
      } else {
        timer = setTimeout(() => {
          start = null;
          raf = requestAnimationFrame(step);
        }, 700);
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [isPlaying, trail, replayKey]);

  // Đổi rally / tua lại: về đầu.
  useEffect(() => setProgress(0), [rallyIndex, replayKey]);

  // Mốc thời gian hiện tại trong rally.
  const playT = rally ? rally.startMs + progress * (rally.endMs - rally.startMs) : 0;

  // Trạng thái bóng hiện tại.
  const ball = pointAt(trail, playT);
  const ballGone = trail.length > 0 && playT > trail[trail.length - 1].t;

  // Vị trí 2 VĐV hiện tại (theo playT).
  const samples = ar.players?.samples ?? [];
  const sample = nearestSample(samples, playT);
  const playerPts: (SvgPoint | null)[] = [0, 1].map((i) => {
    if (!view || !sample) return null;
    const feet = sample.feet?.[i];
    if (!feet) return null;
    const s = toSvg(feet[0], feet[1]);
    return s ? { t: sample.t, x: s.x, y: s.y } : null;
  });

  // Heatmap: ô nào nhiều mẫu hơn -> màu nóng hơn (xanh dương -> lục -> vàng -> đỏ).
  const heatBlobs = useMemo(() => {
    if (!heat || !view) return [] as { player: number; x: number; y: number; r: number; color: string; opacity: number }[];
    const binsX = heat.bins?.x || 22;
    const binsY = heat.bins?.y || 48;
    const blobs: { player: number; x: number; y: number; r: number; color: string; opacity: number }[] = [];
    const cellRX = COURT_BOX.w / binsY; // ô dọc theo chiều dài sân (nằm ngang trên SVG)
    const cellRY = COURT_BOX.hgt / binsX; // ô dọc theo chiều rộng sân (nằm dọc trên SVG)
    for (const entry of heat.players) {
      const cells = entry.cells ?? [];
      if (cells.length === 0) continue;
      const maxCount = Math.max(...cells.map((c) => c[2]), 1);
      const top = [...cells].sort((a, b) => b[2] - a[2]).slice(0, 18);
      for (const [bx, by, count] of top) {
        const xM = ((bx + 0.5) / binsX) * COURT_WIDTH_M;
        const yM = ((by + 0.5) / binsY) * COURT_LENGTH_M;
        const s = view.map(xM, yM);
        const intensity = count / maxCount;
        blobs.push({
          player: entry.playerIndex,
          x: s.x,
          y: s.y,
          r: Math.max(6, (cellRX + cellRY) * (0.4 + 0.45 * intensity)),
          color: heatRampColor(intensity),
          opacity: 0.26 + 0.42 * intensity,
        });
      }
    }
    return blobs;
  }, [heat, view]);

  // Các đường sân vẽ từ hệ mét -> SVG.
  const meter = (xM: number, yM: number) => (view ? view.map(xM, yM) : { x: COURT_BOX.x, y: COURT_BOX.y });
  const poly = (pts: [number, number][]) =>
    pts.map(([x, y]) => { const p = meter(x, y); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');
  const lineOf = (a: [number, number], b: [number, number]) => {
    const pa = meter(a[0], a[1]);
    const pb = meter(b[0], b[1]);
    return { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y };
  };

  const W = COURT_WIDTH_M;
  const L = COURT_LENGTH_M;
  const net = L / 2;
  const svc = SERVICE_FROM_NET_M;

  // Quỹ đạo đã bay (progressive reveal).
  const flown = showTrail ? trail.filter((p) => p.t <= playT) : [];
  const flownStr = flown.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const fullTrailStr = trail.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const rallyLabel = rally
    ? `${Math.floor(rally.startMs / 60000)}:${String(Math.floor((rally.startMs % 60000) / 1000)).padStart(2, '0')}`
    : '--:--';
  const peak = rally?.maxFlightSpeedKmh ?? rally?.avgShotSpeedKmh ?? null;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full h-full max-w-[640px] select-none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="crP1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={P1_COLOR} stopOpacity="0.5" />
          <stop offset="60%" stopColor={P1_COLOR} stopOpacity="0" />
        </radialGradient>
        <filter id="heatBlur" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="crGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Nền */}
      <rect x="0" y="0" width={VW} height={VH} fill="#070b13" rx="6" />

      {!view && (
        <text x={VW / 2} y={VH / 2} fill="#64748b" fontSize="11" fontFamily="monospace" textAnchor="middle">
          Run này không có dữ liệu sân (court) — không dựng được mô phỏng
        </text>
      )}

      {view && (
        <>
          {/* Mặt sân */}
          <polygon
            points={poly([[0, 0], [W, 0], [W, L], [0, L]])}
            fill="#09101c"
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="1.5"
          />

          {/* Vùng kitchen / service boxes (giữa service line và lưới, nằm trong vạch biên đơn) */}
          <polygon points={poly([[SINGLES_INSET_M, net - svc], [W - SINGLES_INSET_M, net - svc], [W - SINGLES_INSET_M, net], [SINGLES_INSET_M, net]])} fill="rgba(76,215,246,0.05)" />
          <polygon points={poly([[SINGLES_INSET_M, net], [W - SINGLES_INSET_M, net], [W - SINGLES_INSET_M, net + svc], [SINGLES_INSET_M, net + svc]])} fill="rgba(202,243,0,0.05)" />

          {/* Viền đơn trong (singles sideline) — chạy baseline tới baseline */}
          <line {...lineOf([SINGLES_INSET_M, 0], [SINGLES_INSET_M, L])} stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
          <line {...lineOf([W - SINGLES_INSET_M, 0], [W - SINGLES_INSET_M, L])} stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />

          {/* Đường sân — service line chỉ nối giữa 2 viền đơn trong (chuẩn tennis) */}
          <line {...lineOf([SINGLES_INSET_M, net - svc], [W - SINGLES_INSET_M, net - svc])} stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
          <line {...lineOf([SINGLES_INSET_M, net + svc], [W - SINGLES_INSET_M, net + svc])} stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" />
          <line {...lineOf([W / 2, net - svc], [W / 2, net + svc])} stroke="rgba(255,255,255,0.25)" strokeWidth="1.2" />
          {/* Lưới */}
          <line {...lineOf([0, net], [W, net])} stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeDasharray="5 3" />
          <text x={meter(SINGLES_INSET_M + 0.3, net - svc / 2).x + 4} y={meter(SINGLES_INSET_M + 0.3, net - svc / 2).y - 3} fill="rgba(255,255,255,0.35)" fontSize="7" fontFamily="monospace">SERVICE BOX</text>
          <text x={meter(SINGLES_INSET_M + 0.3, net + svc / 2).x + 4} y={meter(SINGLES_INSET_M + 0.3, net + svc / 2).y + 9} fill="rgba(255,255,255,0.35)" fontSize="7" fontFamily="monospace">SERVICE BOX</text>

          {/* Heatmap thật: màu theo cường độ (lạnh -> nóng), làm mờ kiểu Hawk-Eye */}
          {showHeatmap && (
            <g filter="url(#heatBlur)">
              {heatBlobs.map((b, i) => (
                <circle
                  key={`h${i}`}
                  cx={b.x}
                  cy={b.y}
                  r={b.r}
                  fill={b.color}
                  fillOpacity={b.opacity}
                />
              ))}
            </g>
          )}

          {/* Quỹ đạo đầy đủ (mờ) + phần đã bay (sáng) */}
          {showTrail && trail.length > 1 && (
            <>
              <polyline points={fullTrailStr} fill="none" stroke="rgba(202,243,0,0.18)" strokeWidth="1.4" strokeDasharray="3 3" />
              {flown.length > 1 && (
                <polyline points={flownStr} fill="none" stroke={BALL_COLOR} strokeWidth="1.8" filter="url(#crGlow)" />
              )}
            </>
          )}

          {/* Điểm nảy bóng */}
          {bounces.map((p, i) => (
            <g key={`b${i}`}>
              <circle cx={p.x} cy={p.y} r="4.5" fill="rgba(255,255,255,0.15)" stroke="#ffffff" strokeWidth="1" />
              <circle cx={p.x} cy={p.y} r="1.6" fill="#ffffff" />
            </g>
          ))}

          {/* Dấu cú đánh */}
          {shots.map((p, i) => (
            <g key={`s${i}`} stroke={BALL_COLOR} strokeWidth="1.2" opacity="0.85">
              <line x1={p.x - 3.5} y1={p.y - 3.5} x2={p.x + 3.5} y2={p.y + 3.5} />
              <line x1={p.x - 3.5} y1={p.y + 3.5} x2={p.x + 3.5} y2={p.y - 3.5} />
            </g>
          ))}

          {/* VĐV */}
          {showPlayers &&
            playerPts.map((p, i) =>
              p ? (
                <g key={`p${i}`} transform={`translate(${p.x}, ${p.y})`}>
                  <circle r="9" fill={i === 0 ? '#0b1726' : '#141c09'} stroke={i === 0 ? P1_COLOR : P2_COLOR} strokeWidth="1.6" filter="url(#crGlow)" />
                  <text y="3" fill={i === 0 ? P1_COLOR : P2_COLOR} fontSize="7.5" fontWeight="bold" fontFamily="monospace" textAnchor="middle">
                    P{i + 1}
                  </text>
                </g>
              ) : null
            )}

          {/* Bóng đang bay */}
          {ball && (
            <g transform={`translate(${ball.x}, ${ball.y})`} opacity={ballGone ? 0.35 : 1}>
              <circle r="4.5" fill="#ffffff" filter="url(#crGlow)" />
              <circle r="2.8" fill={BALL_COLOR} />
            </g>
          )}

          {/* Bảng thông tin rally — số liệu thật */}
          <g transform={`translate(${VW - 128}, 8)`}>
            <rect width="120" height="40" rx="4" fill="#0a0f1d" stroke="rgba(202,243,0,0.5)" strokeWidth="1" />
            <text x="60" y="14" fill={P2_COLOR} fontSize="8" fontWeight="bold" fontFamily="monospace" textAnchor="middle">
              RALLY #{rallyIndex + 1} · {rallyLabel}
            </text>
            <text x="60" y="26" fill="#ffffff" fontSize="9" fontWeight="900" fontFamily="monospace" textAnchor="middle">
              {peak != null ? `${peak} KM/H` : '— KM/H'}
            </text>
            <text x="60" y="35" fill="#8f9bb3" fontSize="7" fontFamily="monospace" textAnchor="middle">
              {rally ? `${rally.shotCount ?? '?'} SHOTS · ${Math.round((rally.endMs - rally.startMs) / 100) / 10}s` : ''}
            </text>
          </g>
        </>
      )}
    </svg>
  );
};
