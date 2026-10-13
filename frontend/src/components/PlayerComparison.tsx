import React from 'react';
import { PlayerStats } from '../types/telemetry';
import { User } from 'lucide-react';

interface PlayerComparisonProps {
  player1: PlayerStats;
  player2: PlayerStats;
}

export const PlayerComparison: React.FC<PlayerComparisonProps> = ({ player1, player2 }) => {
  return (
    <div className="bg-[#111624] border border-white/10 rounded-xl p-4 lg:p-5 relative shadow-lg">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Left Side: Player 1 */}
        <div className="lg:col-span-5 flex flex-col justify-between">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#0e2733] border border-[#4cd7f6]/40 flex items-center justify-center text-[#4cd7f6] font-bold text-xs shadow-[0_0_12px_rgba(76,215,246,0.2)]">
                <span className="flex items-center gap-0.5 font-mono">
                  <User className="w-3.5 h-3.5" />
                  P1
                </span>
              </div>
              <div>
                <h3 className="text-white text-base font-bold flex items-center gap-2">
                  <span>{player1.name}</span>
                  <span className="w-2 h-2 rounded-full bg-[#4cd7f6] inline-block shadow-[0_0_6px_#4cd7f6]"></span>
                </h3>
                <p className="text-[11px] font-mono text-[#718096] tracking-wider uppercase font-semibold">
                  {player1.styleDescription}
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-2xl font-black text-[#4cd7f6] font-telemetry block leading-none">
                {player1.totalShots}
              </span>
              <span className="text-[10px] text-[#718096] font-mono tracking-wider uppercase">
                CÚ ĐÁNH ({player1.shotsPercentage}%)
              </span>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 gap-3 py-2 px-3 rounded-lg bg-[#0c121d] border border-white/5 text-xs font-mono mb-4">
            <div>
              <span className="text-[#64748b] text-[10px] uppercase block">TỐC ĐỘ TB</span>
              <span className="text-white font-bold text-sm">{player1.avgSpeed.toFixed(1)}</span>{' '}
              <span className="text-[#64748b] text-[10px]">km/h</span>
            </div>
            <div className="border-l border-white/5 pl-3">
              <span className="text-[#64748b] text-[10px] uppercase block">GIAO BÓNG MAX</span>
              <span className="text-[#4cd7f6] font-bold text-sm">{player1.maxServeSpeed.toFixed(1)}</span>{' '}
              <span className="text-[#64748b] text-[10px]">km/h</span>
            </div>
          </div>

          {/* Breakdown Bars (P1) */}
          <div className="space-y-2 text-xs font-mono">
            {player1.breakdown.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between gap-3">
                <span className="text-[#94a3b8] text-[11px] shrink-0 w-36 truncate">
                  {item.name}
                </span>
                <div className="flex-1 h-2 bg-[#172033] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#4cd7f6] rounded-full shadow-[0_0_6px_rgba(76,215,246,0.4)]"
                    style={{ width: `${item.percentage}%` }}
                  ></div>
                </div>
                <span className="text-white font-semibold text-[11px] w-12 text-right">
                  {item.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Center: VS & Tactical Battle */}
        <div className="lg:col-span-2 flex flex-col items-center justify-center text-center py-2 px-1 border-t lg:border-t-0 lg:border-l lg:border-r border-white/10 my-2 lg:my-0">
          <span className="text-3xl font-black text-white/80 font-display tracking-widest drop-shadow-sm mb-1">
            VS
          </span>
          <span className="text-[10px] font-mono text-[#8b9bb4] tracking-wider uppercase font-semibold mb-2">
            ĐỐI ĐẦU CHIẾN THUẬT
          </span>

          {/* Split indicator */}
          <div className="w-full max-w-[200px] mb-3">
            <div className="flex justify-between text-[11px] font-mono font-bold mb-1">
              <span className="text-[#4cd7f6]">P1 55%</span>
              <span className="text-[#94a3b8] text-[10px]">Kiểm soát</span>
              <span className="text-[#caf300]">45% P2</span>
            </div>
            <div className="w-full h-2 bg-[#172033] rounded-full overflow-hidden flex shadow-inner">
              <div className="h-full bg-[#4cd7f6]" style={{ width: '55%' }}></div>
              <div className="h-full bg-[#caf300]" style={{ width: '45%' }}></div>
            </div>
          </div>

          {/* Highlight Badge */}
          <div className="px-2.5 py-1 rounded bg-[#1e2d14] border border-[#caf300]/30 text-[#caf300] text-[10px] font-mono font-bold tracking-tight">
            P2 GIAO BÓNG NHANH HƠN +54.9 KM/H
          </div>
        </div>

        {/* Right Side: Player 2 */}
        <div className="lg:col-span-5 flex flex-col justify-between">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="order-2 text-right">
              <span className="text-2xl font-black text-[#caf300] font-telemetry block leading-none">
                {player2.totalShots}
              </span>
              <span className="text-[10px] text-[#718096] font-mono tracking-wider uppercase">
                CÚ ĐÁNH ({player2.shotsPercentage}%)
              </span>
            </div>

            <div className="order-1 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#242b10] border border-[#caf300]/40 flex items-center justify-center text-[#caf300] font-bold text-xs shadow-[0_0_12px_rgba(202,243,0,0.2)]">
                <span className="flex items-center gap-0.5 font-mono">
                  <User className="w-3.5 h-3.5" />
                  P2
                </span>
              </div>
              <div>
                <h3 className="text-white text-base font-bold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#ef4444] inline-block shadow-[0_0_6px_#ef4444]"></span>
                  <span>{player2.name}</span>
                </h3>
                <p className="text-[11px] font-mono text-[#718096] tracking-wider uppercase font-semibold">
                  {player2.styleDescription}
                </p>
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 gap-3 py-2 px-3 rounded-lg bg-[#0c121d] border border-white/5 text-xs font-mono mb-4">
            <div>
              <span className="text-[#64748b] text-[10px] uppercase block">TỐC ĐỘ TB ({player2.avgSpeedDiff})</span>
              <span className="text-white font-bold text-sm">{player2.avgSpeed.toFixed(1)}</span>{' '}
              <span className="text-[#64748b] text-[10px]">km/h</span>
            </div>
            <div className="border-l border-white/5 pl-3">
              <span className="text-[#64748b] text-[10px] uppercase block">GIAO BÓNG MAX (ACE)</span>
              <span className="text-[#caf300] font-bold text-sm">{player2.maxServeSpeed.toFixed(1)}</span>{' '}
              <span className="text-[#64748b] text-[10px]">km/h</span>
            </div>
          </div>

          {/* Breakdown Bars (P2) */}
          <div className="space-y-2 text-xs font-mono">
            {player2.breakdown.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between gap-3">
                <span className="text-white font-semibold text-[11px] w-12 text-left">
                  {item.percentage}%
                </span>
                <div className="flex-1 h-2 bg-[#172033] rounded-full overflow-hidden flex justify-end">
                  <div
                    className="h-full bg-[#caf300] rounded-full shadow-[0_0_6px_rgba(202,243,0,0.4)]"
                    style={{ width: `${item.percentage}%` }}
                  ></div>
                </div>
                <span className="text-[#94a3b8] text-[11px] shrink-0 w-44 text-right truncate">
                  {item.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
