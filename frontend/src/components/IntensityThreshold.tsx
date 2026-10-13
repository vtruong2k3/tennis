import React from 'react';
import { Zap, Timer, Trophy } from 'lucide-react';
import { useTelemetry } from '../api/TelemetryContext';
import { RallyTelemetry } from '../types/telemetry';

export const IntensityThreshold: React.FC = () => {
  const { rallies, match } = useTelemetry();

  const totalRallies = rallies.length || match.totalRallies || 0;

  // 1. Pha bóng có tốc độ bay cao nhất
  const peakRally = rallies.reduce<RallyTelemetry | null>((prev, cur) => {
    if (!prev || (cur.maxSpeed || 0) > (prev.maxSpeed || 0)) return cur;
    return prev;
  }, null);

  const peakSpeed = peakRally?.maxSpeed || match.peakBallSpeed || 0;
  const peakRallyName = peakRally ? `Pha ${peakRally.id}` : (match.peakBallSpeedRally ? `Pha ${match.peakBallSpeedRally}` : 'Pha #13');
  const peakShots = peakRally?.shotsCount ?? 6;
  const peakAvg = peakRally?.avgSpeed ?? 162.1;

  // 2. Pha bóng giằng co nhiều cú đánh nhất
  const maxShots = rallies.reduce((m, r) => Math.max(m, r.shotsCount || 0), 0) || match.recordRallyLength || 9;
  const longestList = rallies.filter((r) => r.shotsCount === maxShots);
  const longestRally = longestList[0];
  const recordRallyName = longestList.length > 0
    ? longestList.map((r) => `Pha ${r.id}`).join(' & ')
    : (match.recordRallies ? `Pha ${match.recordRallies}` : 'Pha #01');
  const recordShots = longestRally?.shotsCount ?? maxShots;
  const recordDuration = longestRally?.durationSeconds ?? 12.0;
  const recordMaxSpeed = longestRally?.maxSpeed ?? 125.4;

  // 3. Tỷ lệ pha bóng có tốc độ cao
  const speedThreshold = peakSpeed > 150 ? 120 : peakSpeed > 90 ? 80 : 60;
  const highSpeedCount = rallies.length > 0
    ? rallies.filter((r) => (r.maxSpeed || 0) >= speedThreshold).length
    : 6;
  const highSpeedPct = totalRallies > 0
    ? Math.round((highSpeedCount / totalRallies) * 100)
    : 38;

  return (
    <div className="bg-[#111624] border border-white/10 rounded-xl p-4 lg:p-5 shadow-lg flex flex-col justify-between">
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <h3 className="text-white text-base font-bold flex items-center gap-2">
          <Trophy className="w-4 h-4 text-[#caf300]" />
          Điểm Nhấn & Kỷ Lục Trận Đấu
        </h3>
        <span className="text-[11px] font-mono text-[#8f9bb3] uppercase tracking-wider font-semibold">
          {totalRallies} pha bóng đã phân tích
        </span>
      </div>

      {/* Two side-by-side cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {/* Card 1: Pha bóng nhanh nhất */}
        <div className="p-3.5 rounded-lg bg-[#0e1710] border border-[#caf300]/30 flex flex-col justify-between relative overflow-hidden group hover:border-[#caf300]/60 transition-colors">
          <div className="text-[11px] font-mono text-[#caf300] font-bold flex items-center justify-between">
            <span className="flex items-center gap-1.5 uppercase tracking-wide">
              <Zap className="w-3.5 h-3.5 text-[#caf300]" />
              Pha bóng nhanh nhất
            </span>
            <span className="bg-[#caf300]/15 text-[#caf300] px-1.5 py-0.5 rounded text-[10px] font-black border border-[#caf300]/30">
              {peakRallyName}
            </span>
          </div>

          <div className="my-2.5">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-black text-white font-telemetry tracking-tight drop-shadow-[0_0_8px_rgba(202,243,0,0.25)]">
                {peakSpeed.toFixed(1)}
              </span>
              <span className="text-xs text-[#caf300] font-mono font-bold">km/h</span>
            </div>
            <p className="text-[11px] font-mono text-[#94a3b8] mt-1.5 leading-snug">
              {peakShots} lần chạm bóng · Tốc độ TB {peakAvg.toFixed(1)} km/h
            </p>
          </div>

          <div className="text-[10px] font-mono text-[#caf300] font-semibold mt-1 pt-1.5 border-t border-white/5 flex items-center gap-1">
            <span>●</span> Cú đánh đạt vận tốc bay cao nhất
          </div>
        </div>

        {/* Card 2: Pha bóng giằng co nhất */}
        <div className="p-3.5 rounded-lg bg-[#0d1624] border border-[#4cd7f6]/30 flex flex-col justify-between relative overflow-hidden group hover:border-[#4cd7f6]/60 transition-colors">
          <div className="text-[11px] font-mono text-[#4cd7f6] font-bold flex items-center justify-between">
            <span className="flex items-center gap-1.5 uppercase tracking-wide">
              <Timer className="w-3.5 h-3.5 text-[#4cd7f6]" />
              Pha giằng co lâu nhất
            </span>
            <span className="bg-[#4cd7f6]/15 text-[#4cd7f6] px-1.5 py-0.5 rounded text-[10px] font-black border border-[#4cd7f6]/30 truncate max-w-[120px]">
              {recordRallyName}
            </span>
          </div>

          <div className="my-2.5">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-black text-white font-telemetry tracking-tight drop-shadow-[0_0_8px_rgba(76,215,246,0.25)]">
                {recordShots}
              </span>
              <span className="text-xs text-[#4cd7f6] font-mono font-bold uppercase">CÚ ĐÁNH</span>
            </div>
            <p className="text-[11px] font-mono text-[#94a3b8] mt-1.5 leading-snug">
              Kéo dài {recordDuration.toFixed(1)} giây · Tốc độ max {recordMaxSpeed.toFixed(1)} km/h
            </p>
          </div>

          <div className="text-[10px] font-mono text-[#4cd7f6] font-semibold mt-1 pt-1.5 border-t border-white/5 flex items-center gap-1">
            <span>●</span> Đôi công bền bỉ qua lại nhiều nhất
          </div>
        </div>
      </div>

      {/* Bottom Bar: Tần suất pha bóng tốc độ cao */}
      <div className="pt-2.5 border-t border-white/10">
        <div className="flex items-center justify-between text-xs font-mono mb-2">
          <span className="text-[#94a3b8] text-[11px] flex items-center gap-1">
            Số pha bóng tốc độ cao (&gt;{speedThreshold} km/h):
          </span>
          <span className="text-white font-bold text-[11px]">
            {highSpeedCount}/{totalRallies} pha bóng <span className="text-[#caf300]">({highSpeedPct}%)</span>
          </span>
        </div>
        <div className="w-full h-2 bg-[#172033] rounded-full overflow-hidden flex shadow-inner">
          <div
            className="h-full bg-gradient-to-r from-[#4cd7f6] to-[#caf300] rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(202,243,0,0.3)]"
            style={{ width: `${Math.min(100, Math.max(5, highSpeedPct))}%` }}
          ></div>
        </div>
      </div>
    </div>
  );
};
