import React, { useEffect, useMemo, useState } from 'react';
import { RallyTelemetry } from '../types/telemetry';
import { Play, Pause, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTelemetry } from '../api/TelemetryContext';
import { useArData, fetchHeatmap, HeatmapData } from '../api/useArData';
import { CourtRealSvg } from './CourtRealSvg';
import { Court3DCanvas } from './Court3DCanvas';
import { buildRally3DTrajectory } from '../api/court3DMap';
import { computePlayerMetrics, hottestCell } from '../api/courtMap';

interface CourtTrackingProps {
  selectedRally?: RallyTelemetry;
  onSelectRally?: (rally: RallyTelemetry) => void;
}

export const CourtTracking: React.FC<CourtTrackingProps> = ({ selectedRally, onSelectRally }) => {
  const { runId, rallies } = useTelemetry();
  const ar = useArData(runId);
  const [heat, setHeat] = React.useState<HeatmapData | null>(null);
  const [replayKey, setReplayKey] = useState(0);

  // Nạp heatmap.json theo run (nạp riêng vì /ar-data chưa gộp file này).
  React.useEffect(() => {
    let cancelled = false;
    setHeat(null);
    if (runId) fetchHeatmap(runId).then((h) => !cancelled && setHeat(h));
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Rally đang chọn tương ứng index nào trong rallies (data thật).
  const rallyIndex = useMemo(() => {
    const start = selectedRally?.startMs;
    if (!ar || start == null) return -1;
    const rs = ar.result?.rallies ?? [];
    return rs.findIndex((r) => Math.abs(r.startMs - start) < 1500);
  }, [ar, selectedRally?.id, selectedRally?.startMs]);

  const hasReal = ar !== null && rallyIndex >= 0 && (ar.court?.segments?.length ?? 0) > 0;

  // Metrics thật cho footer (kitchen/depth/hotspot) — từ heatmap.json.
  const realMetrics = useMemo(() => {
    if (!heat?.players) return null;
    return [0, 1].map((i) => computePlayerMetrics(heat.players.find((p) => p.playerIndex === i)?.cells));
  }, [heat]);
  const hotCell = useMemo(() => {
    if (!heat?.players) return null;
    const p1 = heat.players.find((p) => p.playerIndex === 1);
    return hottestCell(p1?.cells);
  }, [heat]);

  const [viewMode, setViewMode] = useState<'2d' | '3d' | 'trajectory'>('2d');
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [ballProgress, setBallProgress] = useState<number>(1);

  // Dựng dữ liệu 3D thực tế từ telemetry
  const trajectory3D = useMemo(() => {
    return buildRally3DTrajectory(ar, selectedRally ?? null, rallyIndex);
  }, [ar, selectedRally, rallyIndex]);

  // Ball flight animation
  useEffect(() => {
    let animFrame: number;
    let start: number | null = null;
    const duration = 2200; // ms

    const step = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const progress = Math.min(elapsed / duration, 1);
      setBallProgress(progress);

      if (progress < 1) {
        if (isPlaying) {
          animFrame = requestAnimationFrame(step);
        }
      } else {
        // loop animation after pause
        setTimeout(() => {
          if (isPlaying) {
            start = null;
            animFrame = requestAnimationFrame(step);
          }
        }, 800);
      }
    };

    if (isPlaying) {
      animFrame = requestAnimationFrame(step);
    }

    return () => {
      cancelAnimationFrame(animFrame);
    };
  }, [isPlaying, selectedRally?.id]);

  // Trajectory points calculation
  // Start from P1 side (x: 125, y: 160) arching to P2 side impact (x: 410, y: 160)
  const p1X = 125;
  const p1Y = 160;
  const targetX = 410;
  const targetY = 160;
  // Parabolic peak arch
  const currentX = p1X + (targetX - p1X) * ballProgress;
  // Arc peak height
  const arcHeight = Math.sin(ballProgress * Math.PI) * 75;
  const currentY = p1Y - arcHeight;

  return (
    <div className="bg-[#111624] border border-white/10 rounded-xl p-4 lg:p-5 flex flex-col justify-between shadow-lg">
      {/* Header with Title and Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-white text-base font-bold flex items-center gap-2">
            <span className="w-4 h-4 rounded border border-[#4cd7f6] rotate-45 flex items-center justify-center">
              <span className="w-1.5 h-1.5 bg-[#4cd7f6] rounded-full"></span>
            </span>
            Mô Phỏng Sân Đấu & AR Court Tracking
          </h3>
          <p className="text-[10px] font-mono text-[#718096] uppercase tracking-wider font-semibold">
            {hasReal
              ? 'DỮ LIỆU THẬT TỪ ENGINE · HEATMAP 22×48 · QUỸ ĐẠO BÓNG & VỊ TRÍ VĐV'
              : 'HIỂN THỊ MẬT ĐỘ BÓNG 22X48 BINS · PHÂN TÍCH SERVICE BOX & VÙNG GẦN LƯỚI'}
          </p>
        </div>

        {/* Header Actions: Quick Rally Picker & View Switchers */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Rally Picker in Header */}
          {rallies.length > 0 && selectedRally && (
            <div className="flex items-center gap-1 bg-[#0a0f1d] px-2 py-1 rounded-lg border border-white/10 text-xs font-mono">
              <span className="text-[#8f9bb3] text-[10px]">Pha:</span>
              <button
                onClick={() => {
                  const curIdx = rallies.findIndex((r) => r.id === selectedRally?.id);
                  const prevIdx = curIdx > 0 ? curIdx - 1 : rallies.length - 1;
                  onSelectRally?.(rallies[prevIdx]);
                }}
                className="p-1 hover:bg-white/10 rounded text-white"
                title="Pha trước"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <select
                value={selectedRally?.id ?? ''}
                onChange={(e) => {
                  const target = rallies.find((r) => r.id === e.target.value);
                  if (target) onSelectRally?.(target);
                }}
                className="bg-transparent border-none text-[#caf300] font-bold text-xs focus:outline-none cursor-pointer"
              >
                {rallies.map((r, idx) => (
                  <option key={r.id} value={r.id} className="bg-[#111624] text-white">
                    #{String(idx + 1).padStart(2, '0')} — {r.maxSpeed} km/h ({r.shotsCount} chạm)
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const curIdx = rallies.findIndex((r) => r.id === selectedRally?.id);
                  const nextIdx = curIdx < rallies.length - 1 ? curIdx + 1 : 0;
                  onSelectRally?.(rallies[nextIdx]);
                }}
                className="p-1 hover:bg-white/10 rounded text-white"
                title="Pha tiếp theo"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* View Switchers */}
          <div className="flex items-center gap-1 bg-[#0a0f1d] p-1 rounded border border-white/10 shrink-0">
            <button
              onClick={() => setViewMode('2d')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                viewMode === '2d'
                  ? 'bg-[#4cd7f6] text-[#0a0e18] shadow-[0_0_10px_rgba(76,215,246,0.3)]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Tactical 2D
            </button>
            <button
              onClick={() => setViewMode('3d')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                viewMode === '3d'
                  ? 'bg-[#4cd7f6] text-[#0a0e18] shadow-[0_0_10px_rgba(76,215,246,0.3)]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              AR 3D Cam
            </button>
            <button
              onClick={() => setViewMode('trajectory')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                viewMode === 'trajectory'
                  ? 'bg-[#4cd7f6] text-[#0a0e18] shadow-[0_0_10px_rgba(76,215,246,0.3)]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Quỹ Đạo Bay
            </button>
          </div>
        </div>
      </div>

      {/* Court Visualizer SVG Container */}
      <div
        className={`relative w-full aspect-[2.1/1] min-h-[260px] bg-[#070b13] rounded-lg border border-white/10 overflow-hidden flex items-center justify-center p-2 transition-transform duration-500 ${
          viewMode === '3d' ? '[transform:perspective(800px)_rotateX(22deg)_scale(0.96)] shadow-2xl' : ''
        }`}
      >
        {/* Subtle grid background */}
        <div className="absolute inset-0 court-grid-pattern opacity-40"></div>

        {/* Mini playback control bar inside court */}
        <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 bg-[#0b101c]/80 border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-[#94a3b8]">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="text-white hover:text-[#caf300] transition-colors"
            title={isPlaying ? 'Tạm dừng mô phỏng' : 'Phát lại mô phỏng'}
          >
            {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </button>
          <button
            onClick={() => {
              setBallProgress(0);
              setReplayKey((k) => k + 1);
            }}
            className="text-white hover:text-[#4cd7f6] transition-colors"
            title="Tua lại từ đầu"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
          {rallies.length > 0 && (
            <button
              onClick={() => {
                const curIdx = rallies.findIndex((r) => r.id === selectedRally?.id);
                const prevIdx = curIdx > 0 ? curIdx - 1 : rallies.length - 1;
                onSelectRally?.(rallies[prevIdx]);
              }}
              className="text-[#8f9bb3] hover:text-white p-0.5"
              title="Pha trước"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
          )}
          <span className="text-[#caf300] font-bold">RALLY {selectedRally?.id ?? '—'}</span>
          {rallies.length > 0 && (
            <button
              onClick={() => {
                const curIdx = rallies.findIndex((r) => r.id === selectedRally?.id);
                const nextIdx = curIdx < rallies.length - 1 ? curIdx + 1 : 0;
                onSelectRally?.(rallies[nextIdx]);
              }}
              className="text-[#8f9bb3] hover:text-white p-0.5"
              title="Pha tiếp"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
          <span className="text-white/40">|</span>
          <span>{selectedRally ? `${selectedRally.maxSpeed} KM/H` : '—'}</span>
        </div>

        {/* Court Canvas: 3D Three.js khi chọn 3D, hoặc 2D SVG khi chọn Tactical / Trajectory */}
        {viewMode === '3d' ? (
          <div className="w-full h-full min-h-[260px] relative">
            <Court3DCanvas
              points3D={trajectory3D.points}
              bounces3D={trajectory3D.bounces}
              cameraAngle="isometric"
              showHeatmap={true}
              showTrail={true}
              showShadow={true}
              progress={ballProgress}
              heatmapData={heat}
            />
          </div>
        ) : hasReal && ar ? (
          <CourtRealSvg
            ar={ar}
            heat={heat}
            rallyIndex={rallyIndex}
            isPlaying={isPlaying}
            replayKey={replayKey}
            showHeatmap={viewMode !== 'trajectory'}
            showTrail
            showPlayers
          />
        ) : (
        <svg
          viewBox="0 0 540 260"
          className="w-full h-full max-w-[620px] select-none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Heatmap gradients */}
            <radialGradient id="p1Heatmap" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4cd7f6" stopOpacity="0.45" />
              <stop offset="40%" stopColor="#4cd7f6" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#4cd7f6" stopOpacity="0" />
            </radialGradient>

            <radialGradient id="p2Heatmap" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#caf300" stopOpacity="0.45" />
              <stop offset="40%" stopColor="#caf300" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#caf300" stopOpacity="0" />
            </radialGradient>

            <radialGradient id="impactGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#caf300" stopOpacity="0.8" />
              <stop offset="60%" stopColor="#caf300" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#caf300" stopOpacity="0" />
            </radialGradient>

            <filter id="neonGlowVolt" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="neonGlowCyan" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Court Perimeter Base (Perspective Pickleball Court) */}
          <rect
            x="40"
            y="30"
            width="460"
            height="200"
            rx="6"
            fill="#09101c"
            stroke="rgba(255, 255, 255, 0.25)"
            strokeWidth="1.5"
          />

          {/* Center Dividing Net */}
          <line
            x1="270"
            y1="30"
            x2="270"
            y2="230"
            stroke="rgba(255, 255, 255, 0.45)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          {/* Net Posts */}
          <circle cx="270" cy="30" r="2.5" fill="#ffffff" />
          <circle cx="270" cy="230" r="2.5" fill="#ffffff" />

          {/* Kitchen / Non-Volley Zone (NVZ) Lines (7ft from net each side) */}
          {/* Left Kitchen Line */}
          <line
            x1="210"
            y1="30"
            x2="210"
            y2="230"
            stroke="rgba(255, 255, 255, 0.3)"
            strokeWidth="1.2"
          />
          {/* Right Kitchen Line */}
          <line
            x1="330"
            y1="30"
            x2="330"
            y2="230"
            stroke="rgba(255, 255, 255, 0.3)"
            strokeWidth="1.2"
          />

          {/* NVZ Text Labels */}
          <text
            x="200"
            y="42"
            fill="rgba(255, 255, 255, 0.4)"
            fontSize="7"
            fontFamily="monospace"
            textAnchor="end"
            letterSpacing="0.05em"
          >
            SERVICE BOX
          </text>
          <text
            x="340"
            y="42"
            fill="rgba(255, 255, 255, 0.4)"
            fontSize="7"
            fontFamily="monospace"
            textAnchor="start"
            letterSpacing="0.05em"
          >
            SERVICE BOX
          </text>

          {/* Center Service Lines (lưới -> service line, nằm GIỮA 2 đường service line) */}
          {/* Left Centerline */}
          <line
            x1="270"
            y1="130"
            x2="210"
            y2="130"
            stroke="rgba(255, 255, 255, 0.2)"
            strokeWidth="1.2"
          />
          {/* Right Centerline */}
          <line
            x1="270"
            y1="130"
            x2="330"
            y2="130"
            stroke="rgba(255, 255, 255, 0.2)"
            strokeWidth="1.2"
          />

          {/* P1 Heatmap Circles (Left side) */}
          <circle cx="130" cy="155" r="42" fill="url(#p1Heatmap)" />
          <circle cx="180" cy="120" r="30" fill="url(#p1Heatmap)" opacity="0.6" />

          {/* P2 Heatmap Circles (Right side) */}
          <circle cx="390" cy="165" r="48" fill="url(#p2Heatmap)" />
          <circle cx="360" cy="115" r="32" fill="url(#p2Heatmap)" opacity="0.6" />

          {/* Impact Point Hotspot Zone (Landing of Peak Spike) */}
          <circle cx="410" cy="165" r="34" fill="url(#impactGlow)" />
          <circle cx="410" cy="165" r="16" fill="rgba(202, 243, 0, 0.2)" stroke="#caf300" strokeWidth="1" strokeDasharray="3 2" />

          {/* P1 Player Pin */}
          <g transform="translate(125, 160)">
            <circle cx="0" cy="0" r="10" fill="#0b1726" stroke="#4cd7f6" strokeWidth="1.8" filter="url(#neonGlowCyan)" />
            <text x="0" y="3.5" fill="#4cd7f6" fontSize="8" fontWeight="bold" fontFamily="monospace" textAnchor="middle">
              P1
            </text>
          </g>

          {/* P2 Player Pin */}
          <g transform="translate(415, 120)">
            <circle cx="0" cy="0" r="10" fill="#141c09" stroke="#caf300" strokeWidth="1.8" filter="url(#neonGlowVolt)" />
            <text x="0" y="3.5" fill="#caf300" fontSize="8" fontWeight="bold" fontFamily="monospace" textAnchor="middle">
              P2
            </text>
          </g>

          {/* Ball Trajectory Flight Curve (Curved Parabola) */}
          {/* Path: Start at P1 (125, 160) -> Apex over net (270, 75) -> Land at Impact (410, 165) */}
          <path
            d="M 125 160 Q 270 70 410 165"
            fill="none"
            stroke="#caf300"
            strokeWidth="2"
            strokeDasharray="4 3"
            filter="url(#neonGlowVolt)"
          />

          {/* Ground Projection Line (Shadow) */}
          <path
            d="M 125 160 L 410 165"
            fill="none"
            stroke="rgba(255, 255, 255, 0.15)"
            strokeWidth="1"
            strokeDasharray="2 2"
          />

          {/* Animated Flying Ball */}
          <g transform={`translate(${currentX}, ${currentY})`}>
            <circle cx="0" cy="0" r="4.5" fill="#ffffff" filter="url(#neonGlowVolt)" />
            <circle cx="0" cy="0" r="3" fill="#caf300" />
          </g>

          {/* Impact Burst Ring on Landing */}
          <circle cx="410" cy="165" r="4" fill="#ffffff" />
          <line x1="410" y1="165" x2="370" y2="140" stroke="#caf300" strokeWidth="1.2" />

          {/* Impact Callout Box: RALLY #13 PEAK / 253.6 KM/H IMPACT */}
          <g transform="translate(340, 115)">
            <rect
              x="0"
              y="0"
              width="95"
              height="28"
              rx="3"
              fill="#0d1409"
              stroke="#caf300"
              strokeWidth="1"
            />
            <text
              x="47.5"
              y="10"
              fill="#caf300"
              fontSize="7"
              fontWeight="bold"
              fontFamily="monospace"
              textAnchor="middle"
              letterSpacing="0.05em"
            >
              RALLY #13 PEAK
            </text>
            <text
              x="47.5"
              y="22"
              fill="#ffffff"
              fontSize="8"
              fontWeight="900"
              fontFamily="monospace"
              textAnchor="middle"
            >
              253.6 KM/H <tspan fill="#caf300" fontSize="7">IMPACT</tspan>
            </text>
          </g>
        </svg>
        )}
      </div>

      {/* Legend below court */}
      <div className="flex items-center justify-end text-[11px] font-mono text-[#8b9bb4] my-2 pt-1 border-t border-white/5 gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#8b9bb4] font-semibold">THẤP</span>
          <span
            className="inline-block w-28 h-2 rounded-full"
            style={{ background: 'linear-gradient(90deg, rgb(122,22,22), rgb(229,57,34), rgb(255,122,24), rgb(255,214,64))' }}
          />
          <span className="text-[10px] text-[#8b9bb4] font-semibold">CAO</span>
          <span className="text-white/30">|</span>
          <span className="text-[10px]">MẬT ĐỘ ĐỨNG CỦA VĐV</span>
        </div>
      </div>

      {/* 3 Summary Footer Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 pt-2 border-t border-white/10 text-xs font-mono">
        <div className="p-2 rounded bg-[#0a0f1d] border border-white/5">            <span className="text-[#64748b] text-[10px] block uppercase">KIỂM SOÁT VÙNG GẦN LƯỚI</span>
            <div className="flex items-center justify-between text-xs mt-0.5">
              <span className="text-[#4cd7f6] font-bold">P1: {realMetrics ? `${realMetrics[0].kitchenPct}%` : '58.2%'}</span>
              <span className="text-[#caf300] font-bold">P2: {realMetrics ? `${realMetrics[1].kitchenPct}%` : '41.8%'}</span>
            </div>
        </div>

        <div className="p-2 rounded bg-[#0a0f1d] border border-white/5">            <span className="text-[#64748b] text-[10px] block uppercase">ĐỘ SÂU BASELINE</span>
            <div className="flex items-center justify-between text-xs mt-0.5">
              <span className="text-[#4cd7f6] font-bold">P1: {realMetrics ? `${realMetrics[0].baselineDepthM}m` : '4.8m'}</span>
              <span className="text-[#caf300] font-bold">P2: {realMetrics ? `${realMetrics[1].baselineDepthM}m` : '6.2m (Sâu)'}</span>
            </div>
        </div>

        <div className="p-2 rounded bg-[#0a0f1d] border border-white/5">            <span className="text-[#64748b] text-[10px] block uppercase">ĐIỂM NÓNG GIAO BÓNG</span>
            <div className="flex items-center justify-between text-xs mt-0.5">
              <span className="text-white font-medium truncate">
                {hotCell ? `Ô (${hotCell.bx}, ${hotCell.by})` : 'Góc Phải (T-Serve)'}
              </span>
              <span className="text-[#caf300] font-bold">
                {hotCell ? `${hotCell.count} mẫu` : '145.9 km/h'}
              </span>
            </div>
        </div>
      </div>
    </div>
  );
};
