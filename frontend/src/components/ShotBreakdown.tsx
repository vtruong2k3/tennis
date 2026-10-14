import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useTelemetry } from '../api/TelemetryContext';
import { RallyTelemetry } from '../types/telemetry';

const CORE_SHOT_KEYS = ['Forehand', 'Backhand', 'Groundstroke', 'Serve', 'Smash'];

const SHOT_LABELS_VI: Record<string, string> = {
  Forehand: 'FOREHAND',
  Backhand: 'BACKHAND',
  Groundstroke: 'GROUNDSTROKE',
  Serve: 'SERVE',
  Smash: 'SMASH',
  Volley: 'VOLLEY',
};

const round1 = (n: number) => Math.round(n * 10) / 10;

interface CategoryItem {
  key: string;
  label: string;
  p1Shots: string;
  p1Pct: number;
  p2Shots: string;
  p2Pct: number;
  note?: string;
  noteColor?: string;
}

interface ShotBreakdownProps {
  selectedRally?: RallyTelemetry;
}

export const ShotBreakdown: React.FC<ShotBreakdownProps> = ({ selectedRally }) => {
  const { players, match, rallies } = useTelemetry();
  const [scope, setScope] = useState<'match' | 'rally'>('match');

  const p1 = players[0];
  const p2 = players[1];

  // Shot data theo phạm vi (Toàn trận hoặc Theo pha bóng đang chọn)
  const categories: CategoryItem[] = useMemo(() => {
    const list: CategoryItem[] = [];

    if (scope === 'rally' && selectedRally) {
      // Dữ liệu riêng của pha bóng đang chọn
      const rallyBreakdown = selectedRally.breakdown || [];
      const totalRallyShots = selectedRally.shotsCount || 1;

      // Thu thập các shot type có trong pha bóng này
      const foundKeys = new Set<string>();
      rallyBreakdown.forEach((b) => foundKeys.add(b.type));
      if (foundKeys.size === 0) CORE_SHOT_KEYS.slice(0, 4).forEach((k) => foundKeys.add(k));

      foundKeys.forEach((key) => {
        const item = rallyBreakdown.find((b) => b.type.toLowerCase() === key.toLowerCase());
        const count = item?.count || 0;
        // Ước lượng phân bổ theo tỷ lệ cú đánh của 2 VĐV
        const p1Total = p1?.totalShots || 1;
        const p2Total = p2?.totalShots || 1;
        const p1Ratio = p1Total / (p1Total + p2Total);
        const p1Count = Math.round(count * p1Ratio);
        const p2Count = count - p1Count;

        const p1Pct = round1((p1Count / totalRallyShots) * 100);
        const p2Pct = round1((p2Count / totalRallyShots) * 100);

        list.push({
          key,
          label: SHOT_LABELS_VI[key] || `CÚ ${key.toUpperCase()}`,
          p1Shots: `${p1Count} cú (${p1Pct}%)`,
          p1Pct,
          p2Shots: `${p2Count} cú (${p2Pct}%)`,
          p2Pct,
          note: count > 0 ? `Pha ${selectedRally.id}: có ${count} cú ${key}` : undefined,
          noteColor: 'text-[#caf300]',
        });
      });
    } else {
      // Dữ liệu toàn trận thật từ engine
      const p1Map = p1?.shotTypes || {};
      const p2Map = p2?.shotTypes || {};

      const allKeys = new Set<string>([...CORE_SHOT_KEYS, ...Object.keys(p1Map), ...Object.keys(p2Map)]);

      allKeys.forEach((key) => {
        const c1 = p1Map[key] ?? p1?.breakdown?.find((b) => b.type === key || b.name.toLowerCase().startsWith(key.toLowerCase()))?.shots ?? 0;
        const c2 = p2Map[key] ?? p2?.breakdown?.find((b) => b.type === key || b.name.toLowerCase().startsWith(key.toLowerCase()))?.shots ?? 0;

        if (c1 === 0 && c2 === 0 && !CORE_SHOT_KEYS.slice(0, 4).includes(key)) {
          return;
        }

        const p1Total = p1?.totalShots || 1;
        const p2Total = p2?.totalShots || 1;
        const p1Pct = round1((c1 / p1Total) * 100);
        const p2Pct = round1((c2 / p2Total) * 100);

        let note = '';
        let noteColor = 'text-[#8f9bb3]';
        if (c1 > c2 && c1 > 0) {
          const diffPct = round1(((c1 - c2) / Math.max(1, c2)) * 100);
          note = `${p1?.code || 'P1'} chiếm ưu thế ${key.toLowerCase()} (+${diffPct}%)`;
          noteColor = 'text-[#4cd7f6]';
        } else if (c2 > c1 && c2 > 0) {
          note = `${p2?.code || 'P2'} chủ đạo ${key.toLowerCase()} với ${c2} cú uy lực`;
          noteColor = 'text-[#caf300]';
        }

        list.push({
          key,
          label: SHOT_LABELS_VI[key] || `CÚ ${key.toUpperCase()}`,
          p1Shots: `${c1} cú (${p1Pct}%)`,
          p1Pct,
          p2Shots: `${c2} cú (${p2Pct}%)`,
          p2Pct,
          note: note || undefined,
          noteColor,
        });
      });
    }

    return list;
  }, [p1, p2, scope, selectedRally]);

  const totalShotsClassified =
    scope === 'rally' && selectedRally
      ? selectedRally.shotsCount
      : (p1?.totalShots || 0) + (p2?.totalShots || 0) || match.totalShots || 0;

  return (
    <div className="bg-[#111624] border border-white/10 rounded-xl p-4 lg:p-5 shadow-lg">
      {/* Title & Scope Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4">
        <div>
          <h3 className="text-white text-base font-bold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#caf300]" />
            Phân Tích Cơ Cấu Cú Đánh
          </h3>
          <p className="text-[10px] font-mono text-[#718096] uppercase tracking-wider font-semibold">
            {totalShotsClassified} CÚ ĐÁNH PHÂN LOẠI {scope === 'rally' && selectedRally ? `(PHA ${selectedRally.id})` : '(TOÀN TRẬN)'}
          </p>
        </div>

        {/* Scope Toggle Button */}
        {selectedRally && (
          <div className="flex items-center gap-1 bg-[#0a0f1d] p-1 rounded-lg border border-white/10 self-start sm:self-auto font-mono text-[11px]">
            <button
              onClick={() => setScope('match')}
              className={`px-2.5 py-1 rounded transition-colors ${
                scope === 'match'
                  ? 'bg-[#caf300] text-black font-bold shadow-sm'
                  : 'text-[#8f9bb3] hover:text-white'
              }`}
            >
              Toàn Trận
            </button>
            <button
              onClick={() => setScope('rally')}
              className={`px-2.5 py-1 rounded transition-colors ${
                scope === 'rally'
                  ? 'bg-[#4cd7f6] text-black font-bold shadow-sm'
                  : 'text-[#8f9bb3] hover:text-white'
              }`}
            >
              Pha {selectedRally.id}
            </button>
          </div>
        )}
      </div>

      {/* Rows */}
      <div className="space-y-4">
        {categories.map((cat, idx) => (
          <div key={idx} className="space-y-1.5">
            {/* Header: P1 count vs Category Name vs P2 count */}
            <div className="flex items-center justify-between text-xs font-mono font-semibold">
              <span className="text-[#4cd7f6]">{cat.p1Shots}</span>
              <span className="text-white text-[11px] uppercase tracking-wider">{cat.label}</span>
              <span className="text-[#caf300]">{cat.p2Shots}</span>
            </div>

            {/* Dual Bars */}
            <div className="grid grid-cols-2 gap-2 h-2.5">
              {/* Left Bar (P1 - Cyan) right-aligned */}
              <div className="h-full bg-[#172033] rounded-sm overflow-hidden flex justify-end">
                <div
                  className="h-full bg-[#4cd7f6] rounded-sm shadow-[0_0_8px_rgba(76,215,246,0.3)] transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, (cat.p1Pct / 60) * 100))}%` }}
                ></div>
              </div>
              {/* Right Bar (P2 - Lime) left-aligned */}
              <div className="h-full bg-[#172033] rounded-sm overflow-hidden flex justify-start">
                <div
                  className="h-full bg-[#caf300] rounded-sm shadow-[0_0_8px_rgba(202,243,0,0.3)] transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, (cat.p2Pct / 60) * 100))}%` }}
                ></div>
              </div>
            </div>

            {/* Insight Note if present */}
            {cat.note && (
              <p className={`text-[10px] font-mono ${cat.noteColor} text-center tracking-tight pt-0.5`}>
                {cat.note}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
