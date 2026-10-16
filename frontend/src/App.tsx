import React, { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { SummaryCards } from './components/SummaryCards';
import { PlayerComparison } from './components/PlayerComparison';
import { VideoHudPlayer } from './components/VideoHudPlayer';
import { CourtTracking } from './components/CourtTracking';
import { ShotBreakdown } from './components/ShotBreakdown';
import { IntensityThreshold } from './components/IntensityThreshold';
import { RalliesTable } from './components/RalliesTable';
import { TelemetrySpeedScreen } from './components/TelemetrySpeedScreen';
import { RallyAnalysisScreen } from './components/RallyAnalysisScreen';
import { CourtARScreen } from './components/CourtARScreen';
import { RunMonitorPanel } from './components/RunMonitorPanel';
import { useRunMonitor } from './api/useRunMonitor';
import { ExportReportModal } from './components/ExportReportModal';
import { LogsModal } from './components/LogsModal';

import { RallyTelemetry } from './types/telemetry';
import { TelemetryProvider, useTelemetry } from './api/TelemetryContext';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <TelemetryProvider>
        <AppBody />
      </TelemetryProvider>
    </ErrorBoundary>
  );
}

function AppBody() {
  const {
    match: MATCH_INFO,
    players,
    rallies: RALLIES_DATA,
    source,
    runs,
    runId,
    selectRun,
    reload,
    loading,
  } = useTelemetry();
  const runMonitor = useRunMonitor(reload);
  const PLAYER_1 = players[0];
  const PLAYER_2 = players[1];
  const [activeTab, setActiveTab] = useState<string>('overview');
  // Default selected rally is #13 (Peak Record Rally matching Image 1)
  const [selectedRally, setSelectedRally] = useState<RallyTelemetry | undefined>(
    RALLIES_DATA.find((r) => r.id === '#13') || RALLIES_DATA[0]
  );
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [footerModalType, setFooterModalType] = useState<'logs' | 'calibration' | 'privacy' | null>(null);

  // Khi phân tích mới xong: nạp lại danh sách run + chuyển về tab Tổng Quan xem kết quả.
  const handleGoToResults = () => {
    reload();
    setActiveTab('overview');
  };

  // Nút tải dữ liệu: ưu tiên run vừa phân tích xong, nếu không thì run đang chọn trong dropdown.
  const downloadRunId =
    runMonitor.phase === 'completed' && runMonitor.activeRunId ? runMonitor.activeRunId : runId;

  // Khi data thật từ engine về (hoặc đổi run): map rally đang chọn sang object
  // của danh sách hiện tại (giữ nguyên lựa chọn #13 nhưng dùng startMs/maxSpeed
  // thật). Chỉ quay về rally đầu nếu id không còn tồn tại. Không làm này thì
  // selectedRally mãi là object mock (thiếu startMs) → CourtTracking không tìm
  // được rallyIndex và vẽ nhầm SVG mẫu dù dữ liệu thật đã sẵn sàng.
  useEffect(() => {
    if (!RALLIES_DATA || RALLIES_DATA.length === 0) {
      setSelectedRally(undefined);
      return;
    }
    const current = RALLIES_DATA.find((r) => r.id === selectedRally?.id);
    if (!current) {
      setSelectedRally(RALLIES_DATA[0]);
    } else if (current !== selectedRally) {
      setSelectedRally(current);
    }
  }, [RALLIES_DATA, selectedRally]);

  return (
    <div className="min-h-screen bg-[#0b0f19] text-[#dfe2f1] flex flex-col font-sans selection:bg-[#caf300] selection:text-black">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenExport={() => setIsExportOpen(true)}
        runs={runs}
        currentRunId={runId}
        onSelectRun={selectRun}
        onReloadRuns={reload}
        loading={loading}
        matchId={MATCH_INFO.matchId}
        totalRallies={MATCH_INFO.totalRallies}
      />

      {/* Nguồn dữ liệu: live từ engine hay mock */}
      <div className="max-w-[1700px] w-full mx-auto px-3 sm:px-4 lg:px-6">
        <span
          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-[11px] font-mono border ${
            source === 'live'
              ? 'bg-[#caf300]/10 border-[#caf300]/30 text-[#caf300]'
              : 'bg-[#f472b6]/10 border-[#f472b6]/30 text-[#f472b6]'
          }`}
        >
          {source === 'live' ? '● DATA LIVE — tennis-engine' : '● DATA MẪU (mock) — không kết nối được engine'}
        </span>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1700px] w-full mx-auto px-3 sm:px-4 lg:px-6 py-5 space-y-5">
        {/* Panel chạy phân tích mới — tab riêng, SSE realtime */}
        {activeTab === 'analyze' && (
          <RunMonitorPanel
            phase={runMonitor.phase}
            uploadPct={runMonitor.uploadPct}
            activeRunId={runMonitor.activeRunId}
            stage={runMonitor.stage}
            logs={runMonitor.logs}
          error={runMonitor.error}
          startTime={runMonitor.startTime}
          analysisPct={runMonitor.analysisPct}
          rallyDone={runMonitor.rallyDone}
          rallyTotal={runMonitor.rallyTotal}
          onStart={runMonitor.start}
          onCancel={runMonitor.cancel}
          onReset={runMonitor.reset}
          onGoToResults={handleGoToResults}
          downloadRunId={downloadRunId}
          />
        )}
        {/* Screen 1: Tổng Quan Trận Đấu (Exact match to Image 1) */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* Top 5 Metric Cards */}
            <SummaryCards summary={MATCH_INFO} />

            {/* Trình Phát Video Phân Tích & AR Telemetry HUD (Full High-Speed Optical HUD) */}
            <VideoHudPlayer selectedRally={selectedRally} onSelectRally={setSelectedRally} />

            {/* Player Head-to-Head Comparison (VĐV 1 vs VĐV 2) */}
            <PlayerComparison player1={PLAYER_1} player2={PLAYER_2} />

            {/* Mid Section: 2 Columns */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* Left Column: Court Tracking (7 cols on large screens) */}
              <div className="lg:col-span-7 flex flex-col">
                <CourtTracking selectedRally={selectedRally} onSelectRally={setSelectedRally} />
              </div>

              {/* Right Column: Shot Structure & Intensity (5 cols) */}
              <div className="lg:col-span-5 flex flex-col gap-5 justify-between">
                <ShotBreakdown selectedRally={selectedRally} />
                <IntensityThreshold />
              </div>
            </div>

            {/* Bottom Section: Full 16 Rallies Telemetry Table */}
            <RalliesTable
              rallies={RALLIES_DATA}
              selectedRally={selectedRally}
              onSelectRally={(r) => setSelectedRally(r)}
              onOpenExport={() => setIsExportOpen(true)}
            />
          </div>
        )}

        {/* Screen 2: Video & AR HUD */}
        {activeTab === 'video' && <VideoHudPlayer selectedRally={selectedRally} onSelectRally={setSelectedRally} />}

        {/* Screen 3: Telemetry & Tốc Độ */}
        {activeTab === 'telemetry' && <TelemetrySpeedScreen />}

        {/* Screen 3: Phân Tích Rally */}
        {activeTab === 'rally' && <RallyAnalysisScreen />}

        {/* Screen 4: Sơ Đồ Sân (Court AR) */}
        {activeTab === 'court' && <CourtARScreen />}
      </main>


      {/* Modals */}
      <ExportReportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
      />

      <LogsModal
        type={footerModalType}
        onClose={() => setFooterModalType(null)}
      />
    </div>
  );
}
