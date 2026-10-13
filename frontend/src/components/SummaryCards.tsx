import React from 'react';
import { MatchSummary } from '../types/telemetry';
import { useTelemetry } from '../api/TelemetryContext';
import { Zap, Activity, Gauge } from 'lucide-react';

interface SummaryCardsProps {
  summary: MatchSummary;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({ summary }) => {
  const { players } = useTelemetry();
  const p1 = players[0];
  const p2 = players[1];

  const p1Shots = p1?.totalShots ?? 0;
  const p2Shots = p2?.totalShots ?? 0;
  const totalShots = summary.totalShots || (p1Shots + p2Shots) || 1;
  const p1Pct = p1?.shotsPercentage ?? Math.round((p1Shots / totalShots) * 1000) / 10;
  const p2Pct = p2?.shotsPercentage ?? Math.round((p2Shots / totalShots) * 1000) / 10;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
      {/* Card 1: Tổng Số Cú Đánh */}
      <div className="bg-[#111726] border border-white/10 rounded-lg p-3.5 flex flex-col justify-between hover:border-white/20 transition-colors relative overflow-hidden">
        <div className="flex items-center justify-between text-xs text-[#94a3b8] font-semibold tracking-wider uppercase mb-1">
          <span>TỔNG SỐ CÚ ĐÁNH</span>
          <span className="w-2 h-2 rounded-full bg-[#4cd7f6] shadow-[0_0_8px_#4cd7f6]"></span>
        </div>
        <div className="flex items-baseline gap-2 my-1">
          <span className="text-3xl lg:text-4xl font-black text-white font-telemetry tracking-tight">
            {summary.totalShots}
          </span>
          <span className="text-xs font-bold text-[#64748b] tracking-wider uppercase">
            SHOTS
          </span>
        </div>
        <div className="mt-2 text-xs font-mono">
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="text-[#4cd7f6] font-semibold">P1: {p1Shots} ({p1Pct}%)</span>
            <span className="text-[#64748b]">/</span>
            <span className="text-[#caf300] font-semibold">P2: {p2Shots} ({p2Pct}%)</span>
          </div>
          {/* Dual Split Bar */}
          <div className="w-full h-1.5 bg-[#1e293b] rounded-full overflow-hidden flex">
            <div className="h-full bg-[#4cd7f6]" style={{ width: `${p1Pct}%` }}></div>
            <div className="h-full bg-[#caf300]" style={{ width: `${p2Pct}%` }}></div>
          </div>
        </div>
      </div>

      {/* Card 2: Tổng Số Rallies */}
      <div className="bg-[#111726] border border-white/10 rounded-lg p-3.5 flex flex-col justify-between hover:border-white/20 transition-colors">
        <div className="flex items-center justify-between text-xs text-[#94a3b8] font-semibold tracking-wider uppercase mb-1">
          <span>TỔNG SỐ RALLIES</span>
          <Zap className="w-3.5 h-3.5 text-[#caf300]" />
        </div>
        <div className="flex items-baseline gap-2 my-1">
          <span className="text-3xl lg:text-4xl font-black text-white font-telemetry tracking-tight">
            {summary.totalRallies}
          </span>
          <span className="text-xs font-bold text-[#64748b] tracking-wider uppercase">
            PHA BÓNG
          </span>
        </div>
        <div className="mt-2 text-[11px] font-mono leading-relaxed text-[#94a3b8]">
          <p className="truncate">
            Thời lượng: <strong className="text-white font-semibold">{summary.durationFormatted}</strong> · {summary.avgShotsPerRally} chạm/rally
          </p>
          <p className="text-[#cbd5e1] truncate">
            Độ dài kỷ lục: <strong className="text-[#caf300]">{summary.recordRallyLength} chạm</strong> ({summary.recordRallies})
          </p>
        </div>
      </div>

      {/* Card 3: Tốc Độ Bóng Kỷ Lục (MAX) */}
      <div className="bg-[#111726] border border-[#caf300]/30 rounded-lg p-3.5 flex flex-col justify-between hover:border-[#caf300]/60 transition-all relative overflow-hidden bg-gradient-to-br from-[#111726] via-[#111726] to-[#1c2813]">
        <div className="flex items-center justify-between text-xs text-[#caf300] font-semibold tracking-wider uppercase mb-1">
          <span className="flex items-center gap-1 font-bold">
            ⚡ TỐC ĐỘ BÓNG KỶ LỤC
          </span>
          <span className="bg-[#caf300] text-black text-[9px] font-extrabold px-1.5 py-0.5 rounded tracking-wider">
            MAX
          </span>
        </div>
        <div className="flex items-baseline gap-2 my-1">
          <span className="text-3xl lg:text-4xl font-black text-[#caf300] font-telemetry tracking-tight drop-shadow-[0_0_12px_rgba(202,243,0,0.3)]">
            {summary.peakBallSpeed.toFixed(1)}
          </span>
          <span className="text-xs font-bold text-[#a3e635] tracking-wider uppercase">
            KM/H
          </span>
        </div>
        <div className="mt-2 text-[11px] font-mono leading-relaxed">
          <p className="text-[#94a3b8] truncate">
            Ghi nhận tại <strong className="text-white font-semibold">{summary.peakBallSpeedRally}</strong> ({summary.peakBallSpeedTime})
          </p>
          <p className="text-[#caf300] font-semibold truncate">
            Vượt {summary.peakOverTourAvg} km/h so với TB trận
          </p>
        </div>
      </div>

      {/* Card 4: Giao Bóng Nhanh Nhất */}
      <div className="bg-[#111726] border border-white/10 rounded-lg p-3.5 flex flex-col justify-between hover:border-white/20 transition-colors">
        <div className="flex items-center justify-between text-xs text-[#94a3b8] font-semibold tracking-wider uppercase mb-1">
          <span>GIAO BÓNG NHANH NHẤT</span>
          <Gauge className="w-3.5 h-3.5 text-[#4cd7f6]" />
        </div>
        <div className="flex items-baseline gap-2 my-1">
          <span className="text-3xl lg:text-4xl font-black text-white font-telemetry tracking-tight">
            {summary.maxServeSpeed.toFixed(1)}
          </span>
          <span className="text-xs font-bold text-[#64748b] tracking-wider uppercase">
            KM/H
          </span>
        </div>
        <div className="mt-2 text-[11px] font-mono leading-relaxed">
          <p className="text-[#94a3b8] truncate">
            VĐV 1: <strong className={summary.maxServeP1 >= summary.maxServeP2 ? 'text-[#caf300]' : 'text-white'}>{summary.maxServeP1} km/h</strong> · VĐV 2: <strong className={summary.maxServeP2 > summary.maxServeP1 ? 'text-[#caf300]' : 'text-white'}>{summary.maxServeP2} km/h</strong>
          </p>
          <p className="text-[#4cd7f6] font-semibold truncate">
            {summary.maxServeP1 > summary.maxServeP2
              ? 'VĐV 1 sở hữu cú giao bóng uy lực nhất'
              : summary.maxServeP2 > summary.maxServeP1
              ? 'VĐV 2 sở hữu cú giao bóng uy lực nhất'
              : 'Tốc độ giao bóng cân bằng'}
          </p>
        </div>
      </div>

      {/* Card 5: Tốc Độ Đánh Trung Bình */}
      <div className="bg-[#111726] border border-white/10 rounded-lg p-3.5 flex flex-col justify-between hover:border-white/20 transition-colors">
        <div className="flex items-center justify-between text-xs text-[#94a3b8] font-semibold tracking-wider uppercase mb-1">
          <span>TỐC ĐỘ ĐÁNH TRUNG BÌNH</span>
          <Activity className="w-3.5 h-3.5 text-[#94a3b8]" />
        </div>
        <div className="flex items-baseline gap-2 my-1">
          <span className="text-3xl lg:text-4xl font-black text-white font-telemetry tracking-tight">
            {summary.avgMatchSpeed.toFixed(1)}
          </span>
          <span className="text-xs font-bold text-[#64748b] tracking-wider uppercase">
            KM/H
          </span>
        </div>
        <div className="mt-2 text-[11px] font-mono leading-relaxed">
          <p className="text-[#94a3b8] truncate">
            Nhịp độ thi đấu toàn trận
          </p>
          <p className="text-[#cbd5e1] truncate">
            Chênh lệch 2 vận động viên: <strong className="text-white">{summary.speedDiffBetweenPlayers} km/h</strong>
          </p>
        </div>
      </div>
    </div>
  );
};
