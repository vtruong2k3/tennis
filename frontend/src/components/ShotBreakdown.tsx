import React from 'react';
import { BarChart3 } from 'lucide-react';

export const ShotBreakdown: React.FC = () => {
  const categories = [
    {
      label: 'CÚ THUẬN TAY (FOREHAND)',
      p1Shots: '20 cú (42.6%)',
      p1Pct: 42.6,
      p2Shots: '10 cú (26.3%)',
      p2Pct: 26.3,
      note: 'P1 chiếm ưu thế áp đảo thuận tay (+100%)',
      noteColor: 'text-[#4cd7f6]',
    },
    {
      label: 'CÚ TRÁI TAY (BACKHAND)',
      p1Shots: '4 cú (8.5%)',
      p1Pct: 8.5,
      p2Shots: '18 cú (47.4%)',
      p2Pct: 47.4,
      note: 'P2 chủ đạo trái tay với 18 cú đánh uy lực',
      noteColor: 'text-[#caf300]',
    },
    {
      label: 'ĐÁNH NẢY SÀN (GROUNDSTROKE)',
      p1Shots: '15 cú (31.9%)',
      p1Pct: 31.9,
      p2Shots: '6 cú (15.8%)',
      p2Pct: 15.8,
      note: 'P1 bền bỉ bóng bền cuối sân hơn',
      noteColor: 'text-[#4cd7f6]',
    },
    {
      label: 'GIAO BÓNG (SERVE)',
      p1Shots: '8 cú (17.0%)',
      p1Pct: 17.0,
      p2Shots: '4 cú (10.5%)',
      p2Pct: 10.5,
    },
  ];

  return (
    <div className="bg-[#111624] border border-white/10 rounded-xl p-4 lg:p-5 shadow-lg">
      {/* Title */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white text-base font-bold flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#caf300]" />
          Phân Tích Cơ Cấu Cú Đánh
        </h3>
        <span className="text-[10px] font-mono text-[#718096] uppercase tracking-wider font-semibold">
          85 SHOTS PHÂN LOẠI
        </span>
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
                  style={{ width: `${(cat.p1Pct / 50) * 100}%` }}
                ></div>
              </div>
              {/* Right Bar (P2 - Lime) left-aligned */}
              <div className="h-full bg-[#172033] rounded-sm overflow-hidden flex justify-start">
                <div
                  className="h-full bg-[#caf300] rounded-sm shadow-[0_0_8px_rgba(202,243,0,0.3)] transition-all duration-500"
                  style={{ width: `${(cat.p2Pct / 50) * 100}%` }}
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
