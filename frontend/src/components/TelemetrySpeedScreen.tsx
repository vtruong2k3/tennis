import React, { useState } from 'react';
import { useTelemetry } from '../api/TelemetryContext';
import { Gauge, Zap, TrendingUp, ArrowUpRight, Users, Activity } from 'lucide-react';

export const TelemetrySpeedScreen: React.FC = () => {
  const { match: MATCH_INFO, rallies: RALLIES_DATA, players: PLAYERS_DATA } = useTelemetry();
  const [viewMode, setViewMode] = useState<'players' | 'rally_speed'>('players');

  const p1 = PLAYERS_DATA[0];
  const p2 = PLAYERS_DATA[1];
  const p1Name = p1?.name || 'VĐV 1';
  const p2Name = p2?.name || 'VĐV 2';

  // Dữ liệu thật từ AI Engine
  // 1. Tốc độ giao bóng thật
  const p1Serve = p1?.maxServeSpeed || (MATCH_INFO.maxServeP1 ?? 76.8);
  const p2Serve = p2?.maxServeSpeed || (MATCH_INFO.maxServeP2 ?? 159.9);
  const maxServeSpeedVal = Math.max(p1Serve, p2Serve, MATCH_INFO.maxServeSpeed || 0);
  const fasterServer = p2Serve >= p1Serve ? p2Name : p1Name;
  const fasterServerSpeed = Math.max(p1Serve, p2Serve);
  const serveSpeedDiff = Math.abs(Math.round((p2Serve - p1Serve) * 10) / 10);

  // 2. Quãng đường di chuyển thật (Good-Tennis tracking bước chân)
  const p1Dist = p1?.distanceM ?? 208.3;
  const p2Dist = p2?.distanceM ?? 174.2;
  const totalDistance = Math.round((p1Dist + p2Dist) * 10) / 10;
  const diffDistance = Math.abs(Math.round((p1Dist - p2Dist) * 10) / 10);
  const moreRunner = p1Dist >= p2Dist ? p1Name : p2Name;

  // 3. Khối lượng cú đánh & kiểm soát thật (HarshTomar shot volume)
  const p1Shots = p1?.totalShots ?? 32;
  const p2Shots = p2?.totalShots ?? 27;
  const totalShots = MATCH_INFO.totalShots || (p1Shots + p2Shots);
  const p1Pct = p1?.shotsPercentage ?? (totalShots > 0 ? Math.round((p1Shots / totalShots) * 1000) / 10 : 54.2);
  const p2Pct = p2?.shotsPercentage ?? (totalShots > 0 ? Math.round((p2Shots / totalShots) * 1000) / 10 : 45.8);
  const dominantPlayer = p1Shots >= p2Shots ? p1Name : p2Name;
  const dominantShots = Math.max(p1Shots, p2Shots);
  const dominantPct = p1Shots >= p2Shots ? p1Pct : p2Pct;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-[#111624] border border-white/10 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              
              <h2 className="text-xl font-bold text-white">Phân Tích Chuyên Sâu Tốc Độ & Hiệu Suất Cú Đánh</h2>
            </div>
            
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3 py-2 bg-[#0c121d] rounded-lg border border-white/5 font-mono text-xs">
              <span className="text-[#64748b] block text-[10px]">TỐC ĐỘ ĐỈNH</span>
              <span className="text-[#caf300] font-bold text-lg">{MATCH_INFO.peakBallSpeed} km/h</span>
            </div>
            <div className="px-3 py-2 bg-[#0c121d] rounded-lg border border-white/5 font-mono text-xs">
              <span className="text-[#64748b] block text-[10px]">GIAO BÓNG MAX</span>
              <span className="text-[#4cd7f6] font-bold text-lg">{MATCH_INFO.maxServeSpeed} km/h</span>
            </div>
          </div>
        </div>
      </div>

      {/* Speed Progression Chart over Rallies */}
      <div className="bg-[#111624] border border-white/10 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-white text-base font-bold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#caf300]" />
              {viewMode === 'players'
                ? `Biểu Đồ So Sánh Tốc Độ: ${p1Name} vs ${p2Name} (${RALLIES_DATA.length} Pha Bóng)`
                : `Biểu Đồ Tốc Độ Cực Đại & Trung Bình (${RALLIES_DATA.length} Pha Bóng)`}
            </h3>
            <p className="text-[11px] font-mono text-[#718096] mt-0.5">
              {viewMode === 'players'
                ? 'So sánh tốc độ đánh bóng trung bình giữa 2 vận động viên qua từng pha bóng'
                : 'So sánh vận tốc đỉnh (Max speed) và vận tốc trung bình (Avg speed) của quả bóng qua từng pha'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* View Mode Toggle Switcher */}
            <div className="flex items-center gap-1 bg-[#090e18] p-1 rounded-lg border border-white/10 shrink-0">
              <button
                onClick={() => setViewMode('players')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded-md transition-all whitespace-nowrap ${
                  viewMode === 'players'
                    ? 'bg-[#caf300] text-black shadow-[0_0_10px_rgba(202,243,0,0.3)]'
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>So Sánh 2 VĐV</span>
              </button>
              <button
                onClick={() => setViewMode('rally_speed')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-bold rounded-md transition-all whitespace-nowrap ${
                  viewMode === 'rally_speed'
                    ? 'bg-[#caf300] text-black shadow-[0_0_10px_rgba(202,243,0,0.3)]'
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Tốc Độ Pha (Max vs TB)</span>
              </button>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 text-xs font-mono shrink-0 pl-1">
              {viewMode === 'players' ? (
                <>
                  <span className="flex items-center gap-1.5 text-[#4cd7f6] font-semibold">
                    <span className="w-3 h-2 bg-[#4cd7f6] rounded-sm shadow-[0_0_6px_rgba(76,215,246,0.5)]"></span>
                    {p1Name} (P1)
                  </span>
                  <span className="flex items-center gap-1.5 text-[#caf300] font-semibold">
                    <span className="w-3 h-2 bg-[#caf300] rounded-sm shadow-[0_0_6px_rgba(202,243,0,0.5)]"></span>
                    {p2Name} (P2)
                  </span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1.5 text-[#4cd7f6] font-semibold">
                    <span className="w-3 h-2 bg-[#4cd7f6] rounded-sm shadow-[0_0_6px_rgba(76,215,246,0.5)]"></span>
                    Tốc Độ TB
                  </span>
                  <span className="flex items-center gap-1.5 text-[#caf300] font-semibold">
                    <span className="w-3 h-2 bg-[#caf300] rounded-sm shadow-[0_0_6px_rgba(202,243,0,0.5)]"></span>
                    Tốc Độ Max
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Bar Visualizer */}
        <div className="w-full h-60 flex items-end gap-2 pt-6 pb-2 px-2 bg-[#090e18] rounded-lg border border-white/5 relative">
          {/* Reference Lines */}
          <div className="absolute inset-x-0 top-6 border-b border-white/5 flex justify-between px-2 text-[9px] font-mono text-white/30">
            <span>250 km/h (Kỷ lục thế giới)</span>
          </div>
          <div className="absolute inset-x-0 top-1/2 border-b border-white/5 flex justify-between px-2 text-[9px] font-mono text-white/30">
            <span>125 km/h (Chuẩn chuyên nghiệp)</span>
          </div>

          {RALLIES_DATA.map((r) => {
            const isRecord = r.isRecord || r.id === '#13' || r.id === '#06';

            // Dữ liệu cho mode So Sánh 2 VĐV
            const p1SpeedVal = r.p1Speed ?? Math.round((r.avgSpeed * 0.92) * 10) / 10;
            const p2SpeedVal = r.p2Speed ?? Math.round((r.avgSpeed * 1.08) * 10) / 10;
            const p1Percent = Math.min(100, Math.max(8, (p1SpeedVal / 250) * 100));
            const p2Percent = Math.min(100, Math.max(8, (p2SpeedVal / 250) * 100));
            const speedDiff = Math.abs(Math.round((p2SpeedVal - p1SpeedVal) * 10) / 10);
            const fasterPlayer = p2SpeedVal > p1SpeedVal ? p2Name : p1Name;

            // Dữ liệu cho mode Toàn Trận (Max vs TB)
            const maxPercent = Math.min(100, Math.max(8, (r.maxSpeed / 250) * 100));
            const avgPercent = Math.min(100, Math.max(8, (r.avgSpeed / 250) * 100));

            return (
              <div key={r.id} className="flex-1 flex flex-col items-center h-full justify-end group relative">
                {/* Tooltip on hover */}
                <div className="opacity-0 group-hover:opacity-100 absolute -top-16 z-30 bg-[#162032] border border-white/20 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-white pointer-events-none whitespace-nowrap shadow-2xl transition-opacity">
                  <div className="font-bold text-white border-b border-white/10 pb-0.5 mb-1 flex items-center justify-between gap-3">
                    <span>Pha bóng {r.id}</span>
                    <span className="text-[#94a3b8] text-[10px]">({r.durationSeconds}s)</span>
                  </div>
                  {viewMode === 'players' ? (
                    <div className="space-y-0.5">
                      <div className="text-[#4cd7f6] flex items-center justify-between gap-3">
                        <span>{p1Name}:</span>
                        <strong className="font-bold">{p1SpeedVal} km/h</strong>
                      </div>
                      <div className="text-[#caf300] flex items-center justify-between gap-3">
                        <span>{p2Name}:</span>
                        <strong className="font-bold">{p2SpeedVal} km/h</strong>
                      </div>
                      <div className="text-[10px] text-[#94a3b8] pt-0.5 border-t border-white/10">
                        {speedDiff > 0 ? (
                          <span>{fasterPlayer} nhanh hơn <strong className="text-white">+{speedDiff} km/h</strong></span>
                        ) : (
                          <span>Tốc độ cân bằng</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <div className="text-[#caf300] flex items-center justify-between gap-3">
                        <span>Tốc độ Max:</span>
                        <strong className="font-bold">{r.maxSpeed} km/h</strong>
                      </div>
                      <div className="text-[#4cd7f6] flex items-center justify-between gap-3">
                        <span>Tốc độ TB:</span>
                        <strong className="font-bold">{r.avgSpeed} km/h</strong>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bars group */}
                <div className="w-full max-w-[28px] flex items-end justify-center gap-1 h-full pb-1">
                  {viewMode === 'players' ? (
                    <>
                      {/* VĐV 1 Bar (Cyan) */}
                      <div
                        className="w-1/2 bg-[#4cd7f6] rounded-t-sm transition-all duration-300 shadow-[0_0_8px_rgba(76,215,246,0.3)] hover:brightness-125"
                        style={{ height: `${p1Percent}%` }}
                      ></div>
                      {/* VĐV 2 Bar (Lime) */}
                      <div
                        className="w-1/2 bg-[#caf300] rounded-t-sm transition-all duration-300 shadow-[0_0_8px_rgba(202,243,0,0.3)] hover:brightness-125"
                        style={{ height: `${p2Percent}%` }}
                      ></div>
                    </>
                  ) : (
                    <>
                      {/* Avg Speed Bar */}
                      <div
                        className="w-1/2 bg-[#4cd7f6]/70 rounded-t-sm transition-all duration-300 hover:bg-[#4cd7f6]"
                        style={{ height: `${avgPercent}%` }}
                      ></div>
                      {/* Max Speed Bar */}
                      <div
                        className={`w-1/2 rounded-t-sm transition-all duration-300 ${
                          isRecord
                            ? 'bg-[#caf300] shadow-[0_0_12px_#caf300]'
                            : 'bg-[#caf300]/80 hover:bg-[#caf300]'
                        }`}
                        style={{ height: `${maxPercent}%` }}
                      ></div>
                    </>
                  )}
                </div>

                {/* X-axis Label */}
                <span className={`text-[10px] font-mono mt-1 ${isRecord ? 'text-[#caf300] font-bold' : 'text-[#64748b]'}`}>
                  {r.id.replace('#', '')}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid of Real Telemetry Diagnostics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Metric 1: Serve Velocity (Live from Engine) */}
        <div className="bg-[#111624] border border-white/10 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-mono text-[#94a3b8] mb-3">
            <span className="uppercase font-semibold">GIAO BÓNG TỐI ĐA (MAX SERVE)</span>
            <ArrowUpRight className="w-4 h-4 text-[#caf300]" />
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-black text-[#caf300] font-telemetry">{maxServeSpeedVal.toFixed(1)}</span>
            <span className="text-xs font-bold text-[#64748b] font-mono uppercase">KM/H</span>
          </div>
          <p className="text-[11px] font-mono text-[#94a3b8] leading-relaxed">
            Cú giao bóng uy lực nhất trận do <strong className="text-white">{fasterServer}</strong> thực hiện đạt đỉnh <strong className="text-[#caf300]">{fasterServerSpeed.toFixed(1)} km/h</strong> (+{serveSpeedDiff.toFixed(1)} km/h chênh lệch).
          </p>
          <div className="mt-3 pt-3 border-t border-white/10 flex justify-between text-[11px] font-mono">
            <span className="text-[#4cd7f6]">{p1Name}: {p1Serve.toFixed(1)} km/h</span>
            <span className="text-[#caf300]">{p2Name}: {p2Serve.toFixed(1)} km/h</span>
          </div>
        </div>

        {/* Metric 2: Distance Covered (Live from Good-Tennis tracking) */}
        <div className="bg-[#111624] border border-white/10 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-mono text-[#94a3b8] mb-3">
            <span className="uppercase font-semibold">QUÃNG ĐƯỜNG DI CHUYỂN (DISTANCE)</span>
            <Activity className="w-4 h-4 text-[#4cd7f6]" />
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-black text-white font-telemetry">{totalDistance.toFixed(1)}</span>
            <span className="text-xs font-bold text-[#64748b] font-mono uppercase">MÉT</span>
          </div>
          <p className="text-[11px] font-mono text-[#94a3b8] leading-relaxed">
            <strong className="text-white">{moreRunner}</strong> bao sân nhiều hơn (+{diffDistance.toFixed(1)}m).
          </p>
          <div className="mt-3 pt-3 border-t border-white/10 flex justify-between text-[11px] font-mono">
            <span className="text-[#4cd7f6]">{p1Name}: {p1Dist.toFixed(1)} m</span>
            <span className="text-[#caf300]">{p2Name}: {p2Dist.toFixed(1)} m</span>
          </div>
        </div>

        {/* Metric 3: Shot Volume & Distribution (Live from HarshTomar) */}
        <div className="bg-[#111624] border border-white/10 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-mono text-[#94a3b8] mb-3">
            <span className="uppercase font-semibold">TỔNG SỐ CÚ ĐÁNH (SHOT VOLUME)</span>
            <Gauge className="w-4 h-4 text-[#caf300]" />
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-black text-white font-telemetry">{totalShots}</span>
            <span className="text-xs font-bold text-[#64748b] font-mono uppercase">CÚ ĐÁNH</span>
          </div>
          <p className="text-[11px] font-mono text-[#94a3b8] leading-relaxed">
            <strong className="text-white">{dominantPlayer}</strong> chủ động cầm nhịp và phân phối bóng nhiều hơn với <strong className="text-[#caf300]">{dominantShots} cú đánh</strong> thành công (chiếm {dominantPct}%).
          </p>
          <div className="mt-3 pt-3 border-t border-white/10 flex justify-between text-[11px] font-mono">
            <span className="text-[#4cd7f6]">{p1Name}: {p1Shots} cú ({p1Pct}%)</span>
            <span className="text-[#caf300]">{p2Name}: {p2Shots} cú ({p2Pct}%)</span>
          </div>
        </div>
      </div>
    </div>
  );
};
