import React, { useState } from 'react';
import { RallyTelemetry } from '../types/telemetry';
import { Table, Download, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

interface RalliesTableProps {
  rallies: RallyTelemetry[];
  selectedRally?: RallyTelemetry;
  onSelectRally: (rally: RallyTelemetry) => void;
  onOpenExport: () => void;
}

export const RalliesTable: React.FC<RalliesTableProps> = ({
  rallies,
  selectedRally,
  onSelectRally,
  onOpenExport,
}) => {
  const [filter, setFilter] = useState<'all' | 'long' | 'high_speed' | 'serve'>('all');
  const [showAllRows, setShowAllRows] = useState<boolean>(false);

  // Filter logic
  const filteredRallies = rallies.filter((r) => {
    if (filter === 'long') return r.shotsCount > 7;
    if (filter === 'high_speed') return r.maxSpeed > 120;
    if (filter === 'serve') return r.serveSpeed > 100 || r.breakdown.some((b) => b.type.toLowerCase().includes('serve'));
    return true;
  });

  // By default show 10 prominent rows as in Image 1, unless toggled or filtered
  const displayedRows = showAllRows || filter !== 'all' ? filteredRallies : filteredRallies.slice(0, 10);

  return (
    <div className="bg-[#111624] border border-white/10 rounded-xl p-4 lg:p-5 shadow-lg">
      {/* Table Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4 pb-3 border-b border-white/10">
        <div>
          <h3 className="text-white text-base lg:text-lg font-bold flex items-center gap-2">
            <Table className="w-4 h-4 text-[#caf300]" />
            Bảng Thống Kê Chi Tiết Từng Pha Bóng
            <span className="text-xs font-mono font-normal text-[#caf300] bg-[#caf300]/15 px-2 py-0.5 rounded border border-[#caf300]/30 ml-1">
              {rallies.length} pha bóng
            </span>
          </h3>
         
        </div>

        {/* Filters and Export Button */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {/* Segmented Filter Buttons */}
          <div className="flex items-center gap-1 bg-[#0a0f1d] p-1 rounded border border-white/10 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                filter === 'all'
                  ? 'bg-[#caf300] text-[#0a0e18] font-bold shadow-[0_0_10px_rgba(202,243,0,0.3)]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Tất Cả ({rallies.length})
            </button>
            <button
              onClick={() => setFilter('long')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                filter === 'long'
                  ? 'bg-[#caf300] text-[#0a0e18] font-bold shadow-[0_0_10px_rgba(202,243,0,0.3)]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Giằng Co (&gt;7 cú)
            </button>
            <button
              onClick={() => setFilter('high_speed')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                filter === 'high_speed'
                  ? 'bg-[#caf300] text-[#0a0e18] font-bold shadow-[0_0_10px_rgba(202,243,0,0.3)]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Tốc Độ Cao (&gt;120 km/h)
            </button>
            <button
              onClick={() => setFilter('serve')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                filter === 'serve'
                  ? 'bg-[#caf300] text-[#0a0e18] font-bold shadow-[0_0_10px_rgba(202,243,0,0.3)]'
                  : 'text-[#94a3b8] hover:text-white'
              }`}
            >
              Pha Giao Bóng (Serve)
            </button>
          </div>

          {/* Export File Button */}
          <button
            onClick={onOpenExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#162338] hover:bg-[#1f3150] border border-[#4cd7f6]/40 text-[#4cd7f6] text-xs font-mono font-bold tracking-wider transition-colors shrink-0 uppercase"
          >
            <Download className="w-3.5 h-3.5" />
            <span>XUẤT FILE CSV/JSON</span>
          </button>
        </div>
      </div>

      {/* Responsive Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs font-mono">
          <thead>
            <tr className="border-b border-white/10 text-[#64748b] text-[10px] uppercase tracking-wider font-semibold">
              <th className="py-2.5 px-3">PHA BÓNG #</th>
              <th className="py-2.5 px-3">THỜI GIAN</th>
              <th className="py-2.5 px-3">SỐ CÚ ĐÁNH</th>
              <th className="py-2.5 px-3">TỐC ĐỘ TB</th>
              <th className="py-2.5 px-3">TỐC ĐỘ TỐI ĐA</th>
              <th className="py-2.5 px-3">TỐC ĐỘ GIAO BÓNG</th>
              <th className="py-2.5 px-3">CƠ CẤU CÚ ĐÁNH</th>
              <th className="py-2.5 px-3 text-right">TÌNH TRẠNG SÂN</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {displayedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-[#94a3b8] font-mono text-xs">
                  Chưa có pha bóng nào được ghi nhận cho lượt phân tích này.
                </td>
              </tr>
            ) : (
              displayedRows.map((rally) => {
                const isSelected = selectedRally?.id === rally.id;
                const isPeakRow = rally.isRecord || rally.id === '#13';

                return (
                  <tr
                    key={rally.id}
                  onClick={() => onSelectRally(rally)}
                  className={`cursor-pointer transition-colors duration-150 ${
                    isPeakRow
                      ? 'bg-[#1b250d]/80 hover:bg-[#233111] border-l-2 border-l-[#caf300]'
                      : isSelected
                      ? 'bg-[#142338] hover:bg-[#1a2d47] border-l-2 border-l-[#4cd7f6]'
                      : 'hover:bg-white/[0.03]'
                  }`}
                >
                  {/* Column 1: Rally ID */}
                  <td className="py-2.5 px-3 font-bold whitespace-nowrap">
                    {isPeakRow ? (
                      <span className="text-[#caf300] flex items-center gap-1">
                        ⚡ {rally.id}
                      </span>
                    ) : (
                      <span className="text-[#94a3b8]">{rally.id}</span>
                    )}
                  </td>

                  {/* Column 2: Time Range */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className={isPeakRow ? 'text-[#caf300] font-semibold' : 'text-[#cbd5e1]'}>
                      {rally.timeRange}
                    </span>{' '}
                    <span className="text-[#64748b]">({rally.durationSeconds.toFixed(1)}s)</span>
                  </td>

                  {/* Column 3: Shots count badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded bg-[#102a3a] border border-[#4cd7f6]/30 text-[#4cd7f6] font-semibold text-[11px]">
                      {rally.shotsCount} cú đánh
                    </span>
                  </td>

                  {/* Column 4: Avg Speed */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className={`font-semibold ${isPeakRow ? 'text-[#caf300]' : 'text-white'}`}>
                      {rally.avgSpeed.toFixed(1)}
                    </span>{' '}
                    <span className="text-[#64748b] text-[10px]">km/h</span>
                  </td>

                  {/* Column 5: Max Speed */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {isPeakRow ? (
                      <span className="px-2 py-0.5 rounded bg-[#2a3400] border border-[#caf300] text-[#caf300] font-bold text-[11px] shadow-[0_0_8px_rgba(202,243,0,0.3)]">
                        {rally.maxSpeed.toFixed(1)} RECORD
                      </span>
                    ) : (
                      <>
                        <span className="text-white font-semibold">{rally.maxSpeed.toFixed(1)}</span>{' '}
                        <span className="text-[#64748b] text-[10px]">km/h</span>
                      </>
                    )}
                  </td>

                  {/* Column 6: Serve Speed */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      className={`font-semibold ${
                        rally.serveNote
                          ? 'text-[#caf300]'
                          : rally.id === '#16'
                          ? 'text-[#4cd7f6]'
                          : 'text-[#cbd5e1]'
                      }`}
                    >
                      {rally.serveSpeed.toFixed(1)} km/h
                    </span>
                    {rally.serveNote && (
                      <span className="ml-1 text-[#caf300] text-[10px] font-bold">
                        {rally.serveNote}
                      </span>
                    )}
                  </td>

                  {/* Column 7: Breakdown badges */}
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {rally.breakdown.map((item, bIdx) => (
                        <span
                          key={bIdx}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium tracking-tight whitespace-nowrap ${
                            item.badgeClass || 'bg-[#1a2333] text-white/90 border border-white/10'
                          }`}
                        >
                          {item.count} {item.type}
                        </span>
                      ))}
                    </div>
                  </td>

                  {/* Column 8: Court Status */}
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    <span className="text-[#caf300] font-bold text-[11px] tracking-wider">
                      {rally.courtStatus}
                    </span>
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>

      {/* Table Footer with Summary Info */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono text-[#718096] pt-3 mt-2 border-t border-white/10 gap-2">
        <div className="flex items-center gap-3">
          <span>
            Hiển thị {displayedRows.length} pha bóng tiêu biểu / Tổng số {rallies.length} pha ghi nhận
          </span>
          {filter === 'all' && (
            <button
              onClick={() => setShowAllRows(!showAllRows)}
              className="text-[#4cd7f6] hover:underline flex items-center gap-1 font-semibold"
            >
              {showAllRows ? (
                <>Thu gọn <ChevronUp className="w-3 h-3" /></>
              ) : (
                <>Xem đủ toàn bộ {rallies.length} pha bóng <ChevronDown className="w-3 h-3" /></>
              )}
            </button>
          )}
        </div>

        
      </div>
    </div>
  );
};
