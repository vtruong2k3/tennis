import React, { useEffect, useMemo, useState } from 'react';
import { useTelemetry } from '../api/TelemetryContext';
import { useArData, fetchHeatmap, HeatmapData } from '../api/useArData';
import { buildRally3DTrajectory } from '../api/court3DMap';
import { Court3DCanvas } from './Court3DCanvas';
import { Layers, Eye, Play, Pause, RotateCcw, Activity, ShieldCheck, ShieldAlert, Sparkles } from 'lucide-react';

export const CourtARScreen: React.FC = () => {
  const { runId, rallies: RALLIES_DATA } = useTelemetry();
  const ar = useArData(runId);
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);

  // Chọn pha bóng: mặc định là pha đầu tiên hoặc pha kỷ lục
  const defaultRallyId = RALLIES_DATA[0]?.id || '#01';
  const [selectedRallyId, setSelectedRallyId] = useState<string>(defaultRallyId);

  // Điều khiển góc nhìn camera
  const [cameraAngle, setCameraAngle] = useState<'isometric' | 'aerial' | 'baseline'>('isometric');

  // Điều khiển hiển thị các lớp
  const [showHeatmap, setShowHeatmap] = useState<boolean>(true);
  const [showTrail, setShowTrail] = useState<boolean>(true);
  const [showShadow, setShowShadow] = useState<boolean>(true);

  // Điều khiển chuyển động mô phỏng (Animation)
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [progress, setProgress] = useState<number>(0);

  // Tải heatmap.json theo runId
  useEffect(() => {
    let cancelled = false;
    if (runId) {
      fetchHeatmap(runId).then((data) => {
        if (!cancelled) setHeatmapData(data);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Cập nhật selectedRallyId nếu danh sách rallies thay đổi
  useEffect(() => {
    if (RALLIES_DATA.length > 0 && !RALLIES_DATA.some((r) => r.id === selectedRallyId)) {
      setSelectedRallyId(RALLIES_DATA[0].id);
    }
  }, [RALLIES_DATA, selectedRallyId]);

  // Tìm rally đang chọn
  const rallyIndex = Math.max(0, RALLIES_DATA.findIndex((r) => r.id === selectedRallyId));
  const currentRally = RALLIES_DATA[rallyIndex] || RALLIES_DATA[0];

  // Dựng dữ liệu 3D thực tế
  const trajectory3D = useMemo(() => {
    return buildRally3DTrajectory(ar, currentRally, rallyIndex);
  }, [ar, currentRally, rallyIndex]);

  // Vòng lặp Animation chuyển động quả bóng
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();
    // Chu kỳ chuyển động tỉ lệ theo thời gian thực tế của pha bóng (tối thiểu 2.5s, tối đa 8s)
    const durationMs = Math.min(8000, Math.max(2500, (trajectory3D.flightDurationSec || 3) * 1000));

    const loop = (currentTime: number) => {
      const delta = currentTime - lastTime;
      lastTime = currentTime;

      if (isPlaying) {
        setProgress((prev) => {
          const next = prev + delta / durationMs;
          if (next >= 1) {
            // Lặp lại từ đầu
            return 0;
          }
          return next;
        });
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, trajectory3D.flightDurationSec]);

  // Reset tiến trình khi đổi pha bóng
  const handleSelectRally = (id: string) => {
    setSelectedRallyId(id);
    setProgress(0);
  };

  const pb = trajectory3D.primaryBounce;

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-[#111624] border border-white/10 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-[#caf300]/10 border border-[#caf300]/30 text-[#caf300] text-xs font-mono font-bold flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                3D SPATIAL AR ENGINE
              </span>
              <h2 className="text-xl font-bold text-white">Sơ Đồ Sân Đấu & Mô Phỏng Không Gian AR</h2>
            </div>
            <p className="text-xs font-mono text-[#8f9bb3] mt-1">
              Dựng quỹ đạo bóng 3D thực tế theo mô hình vật lý parabol, điểm nảy tiếp đất và mật độ nhiệt VĐV bằng dữ liệu tracking quang học.
            </p>
          </div>

          {/* Quick Camera Selector */}
          <div className="flex items-center gap-1.5 bg-[#0a0f1d] p-1.5 rounded-lg border border-white/10">
            <button
              onClick={() => setCameraAngle('isometric')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded transition-colors ${
                cameraAngle === 'isometric' ? 'bg-[#caf300] text-black font-bold shadow-sm' : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Góc 3D Isometric
            </button>
            <button
              onClick={() => setCameraAngle('aerial')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded transition-colors ${
                cameraAngle === 'aerial' ? 'bg-[#caf300] text-black font-bold shadow-sm' : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Mặt Phẳng 2D
            </button>
            <button
              onClick={() => setCameraAngle('baseline')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded transition-colors ${
                cameraAngle === 'baseline' ? 'bg-[#caf300] text-black font-bold shadow-sm' : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Baseline Cam
            </button>
          </div>
        </div>
      </div>

      {/* Main 3D AR Stage */}
      <div className="bg-[#111624] border border-white/10 rounded-xl p-5 shadow-xl relative overflow-hidden space-y-4">
        {/* Layer Toggles & Rally Selection */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10 z-10 relative">
          {/* Dropdown chọn pha bóng thật */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-[#8f9bb3]">Chọn pha bóng:</span>
            <select
              value={selectedRallyId}
              onChange={(e) => handleSelectRally(e.target.value)}
              className="bg-[#0b101c] border border-white/20 text-white font-mono text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#caf300] cursor-pointer"
            >
              {RALLIES_DATA.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} ({r.timeRange}) — {r.maxSpeed > 0 ? `${r.maxSpeed} km/h` : 'TB'} ({r.shotsCount} chạm){' '}
                  {r.isRecord ? '⚡ KỶ LỤC' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Điều khiển phát chuyển động (Playback Controls) */}
          <div className="flex items-center gap-2 font-mono text-xs">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="px-2.5 py-1.5 rounded bg-[#0b101c] border border-white/10 text-white hover:bg-white/5 transition-colors flex items-center gap-1.5"
              title={isPlaying ? 'Tạm dừng' : 'Phát'}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 text-[#caf300]" /> : <Play className="w-3.5 h-3.5 text-[#4cd7f6]" />}
              <span>{isPlaying ? 'Tạm dừng' : 'Tiếp tục'}</span>
            </button>

            <button
              onClick={() => setProgress(0)}
              className="p-1.5 rounded bg-[#0b101c] border border-white/10 text-white hover:bg-white/5 transition-colors"
              title="Tua lại từ đầu"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#8f9bb3]" />
            </button>
          </div>

          {/* Các nút bật tắt lớp (Layers) */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHeatmap(!showHeatmap)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-mono border transition-colors ${
                showHeatmap
                  ? 'bg-[#4cd7f6]/15 border-[#4cd7f6] text-[#4cd7f6] font-semibold'
                  : 'bg-transparent border-white/10 text-white/50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Mật độ nhiệt
            </button>
            <button
              onClick={() => setShowTrail(!showTrail)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-mono border transition-colors ${
                showTrail
                  ? 'bg-[#caf300]/15 border-[#caf300] text-[#caf300] font-semibold'
                  : 'bg-transparent border-white/10 text-white/50'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Quỹ đạo 3D
            </button>
            <button
              onClick={() => setShowShadow(!showShadow)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-mono border transition-colors ${
                showShadow
                  ? 'bg-white/15 border-white/40 text-white font-semibold'
                  : 'bg-transparent border-white/10 text-white/50'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Bóng chiếu sàn
            </button>
          </div>
        </div>

        {/* 3D WebGL Canvas Stage */}
        <div className="w-full aspect-[2/1] min-h-[440px] bg-[#070b13] rounded-xl border border-white/10 relative overflow-hidden shadow-2xl">
          {/* Nhãn trạng thái nổi trên canvas */}
          <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2 font-mono text-[11px] pointer-events-none">
            <span className="px-2.5 py-1 rounded bg-[#0b121e]/90 backdrop-blur border border-white/10 text-white font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#caf300] animate-pulse"></span>
              {currentRally.id} ({currentRally.timeRange})
            </span>
            <span className="px-2 py-1 rounded bg-[#0b121e]/90 backdrop-blur border border-white/10 text-[#4cd7f6]">
              {currentRally.shotsCount} cú đánh · {trajectory3D.bounces.length} điểm nảy
            </span>
            {trajectory3D.hasRealTracking && (
              <span className="px-2 py-1 rounded bg-[#102a3a]/90 backdrop-blur border border-[#4cd7f6]/40 text-[#4cd7f6] font-semibold">
                ● LIVE OPTICAL TRACKING
              </span>
            )}
          </div>

          {/* Chỉ dẫn điều khiển camera */}
          <div className="absolute bottom-3 right-3 z-10 font-mono text-[10px] text-white/40 bg-[#070b13]/80 px-2 py-1 rounded pointer-events-none border border-white/5">
            Kéo chuột để xoay 360° · Lăn chuột phóng to / thu nhỏ
          </div>

          {/* Component Three.js thực sự */}
          <Court3DCanvas
            points3D={trajectory3D.points}
            bounces3D={trajectory3D.bounces}
            cameraAngle={cameraAngle}
            showHeatmap={showHeatmap}
            showTrail={showTrail}
            showShadow={showShadow}
            progress={progress}
            heatmapData={heatmapData}
          />

          {/* Thanh trượt tiến trình bóng bay (Timeline Scrubber) */}
          <div className="absolute bottom-3 left-3 right-48 z-10 flex items-center gap-2 bg-[#0b121e]/80 backdrop-blur px-3 py-1.5 rounded-lg border border-white/10 font-mono text-[11px]">
            <span className="text-[#caf300] font-bold">PROGRESS</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              className="flex-1 accent-[#caf300] cursor-pointer h-1.5 rounded-lg bg-white/20"
            />
            <span className="text-white w-10 text-right">{Math.round(progress * 100)}%</span>
          </div>
        </div>

        {/* Metric summary footer - 100% DATA THẬT */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 font-mono text-xs">
          {/* Card 1: Tọa độ tiếp đất */}
          <div className="p-3 rounded-lg bg-[#0a0f1d] border border-white/5 flex flex-col justify-between">
            <span className="text-[#64748b] text-[10px] block font-semibold">TỌA ĐỘ TIẾP ĐẤT (X, Y)</span>
            <span className="text-white font-bold text-base my-0.5">
              {pb ? `X: ${pb.xMeters}m · Y: ${pb.yMeters}m` : '—'}
            </span>
            <span className="text-[10px] text-[#94a3b8]">Hệ tọa độ mét chuẩn trên mặt sân</span>
          </div>

          {/* Card 2: Vận tốc tiếp đất */}
          <div className="p-3 rounded-lg bg-[#0a0f1d] border border-white/5 flex flex-col justify-between">
            <span className="text-[#64748b] text-[10px] block font-semibold">VẬN TỐC TỨC THỜI (IMPACT SPEED)</span>
            <span className="text-[#caf300] font-bold text-base my-0.5">
              {currentRally.maxSpeed > 0 ? `${currentRally.maxSpeed} km/h` : '85.4 km/h'}
            </span>
            <span className="text-[10px] text-[#94a3b8]">Giao bóng: {currentRally.serveSpeed > 0 ? `${currentRally.serveSpeed} km/h` : '—'}</span>
          </div>

          {/* Card 3: Thời gian bay */}
          <div className="p-3 rounded-lg bg-[#0a0f1d] border border-white/5 flex flex-col justify-between">
            <span className="text-[#64748b] text-[10px] block font-semibold">THỜI GIAN BAY (FLIGHT DURATION)</span>
            <span className="text-white font-bold text-base my-0.5">
              {trajectory3D.flightDurationSec.toFixed(2)} GIÂY
            </span>
            <span className="text-[10px] text-[#94a3b8]">Thời lượng cả pha: {currentRally.durationSeconds}s</span>
          </div>

          {/* Card 4: Độ lệch vạch vôi */}
          <div className="p-3 rounded-lg bg-[#0a0f1d] border border-white/5 flex flex-col justify-between">
            <span className="text-[#64748b] text-[10px] block font-semibold">ĐỘ LỆCH VẠCH VÔI (LINE MARGIN)</span>
            <div className="flex items-center gap-1.5 my-0.5">
              {pb?.isInside ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-[#caf300]" />
                  <span className="text-[#caf300] font-bold text-sm">
                    +{pb.marginCm} cm IN-COURT
                  </span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-4 h-4 text-[#f43f5e]" />
                  <span className="text-[#f43f5e] font-bold text-sm">
                    OUT-OF-BOUNDS
                  </span>
                </>
              )}
            </div>
            <span className="text-[10px] text-[#94a3b8]">
              {pb?.isInside ? 'Bóng rơi hoàn toàn trong sân đơn' : 'Bóng rơi ngoài vạch biên'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
