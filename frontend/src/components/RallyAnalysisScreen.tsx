import React, { useMemo, useState } from 'react';
import { useTelemetry } from '../api/TelemetryContext';
import { Target, ChevronLeft, ChevronRight } from 'lucide-react';

export const RallyAnalysisScreen: React.FC = () => {
  const { match: MATCH_INFO, rallies: RALLIES_DATA } = useTelemetry();

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(4);
  const [filterType, setFilterType] = useState<'all' | 'short' | 'med' | 'long'>('all');

  const total = RALLIES_DATA.length || 1;
  const shortRallies = useMemo(() => RALLIES_DATA.filter((r) => r.shotsCount <= 4), [RALLIES_DATA]);
  const medRallies = useMemo(() => RALLIES_DATA.filter((r) => r.shotsCount >= 5 && r.shotsCount <= 7), [RALLIES_DATA]);
  const longRallies = useMemo(() => RALLIES_DATA.filter((r) => r.shotsCount >= 8), [RALLIES_DATA]);

  const shortPct = Math.round((shortRallies.length / total) * 1000) / 10;
  const medPct = Math.round((medRallies.length / total) * 1000) / 10;
  const longPct = Math.round((longRallies.length / total) * 1000) / 10;

  const shortRallyIds = shortRallies.map((r) => r.id).join(', ');
  const medRallyIds = medRallies.map((r) => r.id).join(', ');
  const longRallyIds = longRallies.map((r) => r.id).join(', ');

  const filteredRallies = useMemo(() => {
    switch (filterType) {
      case 'short':
        return shortRallies;
      case 'med':
        return medRallies;
      case 'long':
        return longRallies;
      default:
        return RALLIES_DATA;
    }
  }, [filterType, shortRallies, medRallies, longRallies, RALLIES_DATA]);

  const totalPages = Math.max(1, Math.ceil(filteredRallies.length / pageSize));
  const validPage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedRallies = useMemo(() => {
    const start = (validPage - 1) * pageSize;
    return filteredRallies.slice(start, start + pageSize);
  }, [filteredRallies, validPage, pageSize]);

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-[#111624] border border-white/10 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              
              <h2 className="text-xl font-bold text-white">Phân Tích Chi Tiết Từng Pha Bóng </h2>
            </div>
            
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3 py-2 bg-[#0c121d] rounded-lg border border-white/5 font-mono text-xs">
              <span className="text-[#64748b] block text-[10px]">TỔNG SỐ PHA BÓNG</span>
              <span className="text-white font-bold text-lg">{RALLIES_DATA.length} Pha</span>
            </div>
            <div className="px-3 py-2 bg-[#0c121d] rounded-lg border border-white/5 font-mono text-xs">
              <span className="text-[#64748b] block text-[10px]">KỶ LỤC GIẰNG CO</span>
              <span className="text-[#caf300] font-bold text-lg">{MATCH_INFO.recordRallyLength} Chạm</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3 Categories of Rally Lengths */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Short: 1-4 shots */}
        <div className="bg-[#111624] border border-white/10 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-mono mb-2">
              <span className="text-[#94a3b8] font-bold">RALLY NGẮN (1 - 4 CHẠM)</span>
              <span className="text-[#caf300] font-bold">{shortRallies.length} PHA BÓNG</span>
            </div>
            <div className="text-2xl font-black text-white font-telemetry mb-2">{shortPct}%</div>
            <p className="text-[11px] font-mono text-[#8f9bb3] leading-relaxed">
              Các pha dứt điểm chớp nhoáng từ cú giao bóng ăn điểm trực tiếp (Ace), trả giao hỏng hoặc dứt điểm Winner ngay cú thứ 3.
              
            </p>
          </div>
          <div className="mt-3 w-full h-1.5 bg-[#172033] rounded-full overflow-hidden">
            <div className="h-full bg-[#caf300] transition-all duration-500" style={{ width: `${shortPct}%` }}></div>
          </div>
        </div>

        {/* Medium: 5-7 shots */}
        <div className="bg-[#111624] border border-white/10 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-mono mb-2">
              <span className="text-[#94a3b8] font-bold">RALLY TRUNG BÌNH (5 - 7 CHẠM)</span>
              <span className="text-[#4cd7f6] font-bold">{medRallies.length} PHA BÓNG</span>
            </div>
            <div className="text-2xl font-black text-white font-telemetry mb-2">{medPct}%</div>
            <p className="text-[11px] font-mono text-[#8f9bb3] leading-relaxed">
              Các pha bóng giằng co xây dựng thế trận tấn công chiến thuật (Serve + 1, ép góc sâu hoặc chuyển trạng thái lên lưới).
              
            </p>
          </div>
          <div className="mt-3 w-full h-1.5 bg-[#172033] rounded-full overflow-hidden">
            <div className="h-full bg-[#4cd7f6] transition-all duration-500" style={{ width: `${medPct}%` }}></div>
          </div>
        </div>

        {/* Long: 8+ shots */}
        <div className="bg-[#111624] border border-white/10 rounded-xl p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-mono mb-2">
              <span className="text-[#94a3b8] font-bold">RALLY DÀI (≥ 8 CHẠM)</span>
              <span className="text-[#f59e0b] font-bold">{longRallies.length} PHA BÓNG</span>
            </div>
            <div className="text-2xl font-black text-white font-telemetry mb-2">{longPct}%</div>
            <p className="text-[11px] font-mono text-[#8f9bb3] leading-relaxed">
              Những màn đấu bóng bền giằng co cuối sân (Baseline rally) thử thách thể lực, độ bền và độ ổn định tâm lý của 2 tay vợt.
              
            </p>
          </div>
          <div className="mt-3 w-full h-1.5 bg-[#172033] rounded-full overflow-hidden">
            <div className="h-full bg-[#f59e0b] transition-all duration-500" style={{ width: `${longPct}%` }}></div>
          </div>
        </div>
      </div>

      {/* Rallies List Card View */}
      <div className="bg-[#111624] border border-white/10 rounded-xl p-5 shadow-lg space-y-4">
        {/* Header & Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-[#caf300]" />
            <h3 className="text-white text-base font-bold">Dòng Thời Gian Chi Tiết Từng Pha Bóng</h3>
            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-xs font-mono text-[#8f9bb3]">
              {filteredRallies.length} pha bóng
            </span>
          </div>

          {/* Filters & Page Size controls */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            {/* Quick Category Filter */}
            <div className="inline-flex rounded-lg bg-[#0c121d] p-1 border border-white/10">
              <button
                onClick={() => {
                  setFilterType('all');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  filterType === 'all'
                    ? 'bg-[#4cd7f6] text-black shadow-sm'
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                Tất cả ({RALLIES_DATA.length})
              </button>
              <button
                onClick={() => {
                  setFilterType('short');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  filterType === 'short'
                    ? 'bg-[#caf300] text-black shadow-sm'
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                1-4 Chạm ({shortRallies.length})
              </button>
              <button
                onClick={() => {
                  setFilterType('med');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  filterType === 'med'
                    ? 'bg-[#4cd7f6] text-black shadow-sm'
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                5-7 Chạm ({medRallies.length})
              </button>
              <button
                onClick={() => {
                  setFilterType('long');
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  filterType === 'long'
                    ? 'bg-[#f59e0b] text-black shadow-sm'
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                ≥ 8 Chạm ({longRallies.length})
              </button>
            </div>

            {/* Page Size selector */}
            <div className="flex items-center gap-1.5 pl-2 border-l border-white/10 text-[#94a3b8]">
              <span>Hiển thị:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-[#0c121d] border border-white/10 rounded px-2 py-1 text-white focus:outline-none focus:border-[#4cd7f6] cursor-pointer"
              >
                <option value={4}>4 / trang</option>
                <option value={6}>6 / trang</option>
                <option value={8}>8 / trang</option>
                <option value={999}>Tất cả</option>
              </select>
            </div>
          </div>
        </div>

        {/* Paginated Cards Grid */}
        {paginatedRallies.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
            {paginatedRallies.map((rally) => (
              <div
                key={rally.id}
                className={`p-3.5 rounded-lg border ${
                  rally.isRecord
                    ? 'bg-[#1b250d] border-[#caf300]/50 shadow-[0_0_15px_rgba(202,243,0,0.08)]'
                    : 'bg-[#0c121d] border-white/5 hover:border-white/20'
                } transition-colors flex flex-col justify-between`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${rally.isRecord ? 'text-[#caf300]' : 'text-white'}`}>
                      {rally.id} ({rally.timeRange})
                    </span>
                    {rally.isRecord && (
                      <span className="px-1.5 py-0.2 text-[9px] font-bold rounded bg-[#caf300]/20 text-[#caf300] border border-[#caf300]/40">
                        KỶ LỤC GIẰNG CO
                      </span>
                    )}
                  </div>
                  <span className="px-2 py-0.5 rounded bg-white/10 text-white text-[10px]">
                    {rally.shotsCount} chạm · {rally.durationSeconds}s
                  </span>
                </div>

                <div className="flex items-center justify-between text-[#94a3b8] text-[11px] my-1">
                  <span>
                    Vận tốc đỉnh:{' '}
                    <strong className={rally.isRecord ? 'text-[#caf300]' : 'text-white'}>
                      {rally.maxSpeed > 0 ? `${rally.maxSpeed} km/h` : '—'}
                    </strong>
                  </span>
                  <span>
                    Giao bóng:{' '}
                    <strong className="text-[#4cd7f6]">
                      {rally.serveSpeed > 0 ? `${rally.serveSpeed} km/h` : '—'}
                    </strong>
                  </span>
                </div>

                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {rally.breakdown.length > 0 ? (
                    rally.breakdown.map((b, idx) => (
                      <span key={idx} className="px-1.5 py-0.5 rounded bg-[#162338] text-[10px] text-[#4cd7f6] border border-[#233552]">
                        {b.count} {b.type}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] text-[#64748b]">Chưa phân loại chi tiết</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-10 text-center text-slate-500 font-mono text-xs">
            Không tìm thấy pha bóng nào phù hợp với bộ lọc hiện tại.
          </div>
        )}

        {/* Pagination Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-white/10 font-mono text-xs text-[#94a3b8]">
          <div className="flex items-center gap-2">
            <span>
              Hiển thị{' '}
              <strong className="text-white">
                {filteredRallies.length === 0 ? 0 : (validPage - 1) * pageSize + 1} -{' '}
                {Math.min(validPage * pageSize, filteredRallies.length)}
              </strong>{' '}
              trong tổng số <strong className="text-white">{filteredRallies.length}</strong> pha bóng
            </span>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              {/* Nút Trang Trước */}
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={validPage === 1}
                className="px-2.5 py-1.5 rounded bg-[#0c121d] border border-white/10 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/5 transition-colors flex items-center gap-1"
                title="Trang trước"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Trước</span>
              </button>

              {/* Danh sách các trang */}
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-7 h-7 rounded text-xs font-bold transition-colors ${
                      page === validPage
                        ? 'bg-[#caf300] text-black shadow-[0_0_8px_rgba(202,243,0,0.3)]'
                        : 'bg-[#0c121d] border border-white/10 text-white hover:bg-white/5'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>

              {/* Nút Trang Sau */}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={validPage === totalPages}
                className="px-2.5 py-1.5 rounded bg-[#0c121d] border border-white/10 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/5 transition-colors flex items-center gap-1"
                title="Trang sau"
              >
                <span>Sau</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
