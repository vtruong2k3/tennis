import React, { useState } from 'react';
import { useTelemetry } from '../api/TelemetryContext';
import { X, Download, FileJson, FileSpreadsheet, Check, Copy } from 'lucide-react';

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportReportModal: React.FC<ExportReportModalProps> = ({ isOpen, onClose }) => {
  const { match: MATCH_INFO, players, rallies: RALLIES_DATA } = useTelemetry();
  const PLAYER_1 = players[0];
  const PLAYER_2 = players[1];
  const [activeTab, setActiveTab] = useState<'json' | 'csv'>('json');
  const [copied, setCopied] = useState<boolean>(false);

  if (!isOpen) return null;

  // Generate JSON payload
  const telemetryJsonData = {
    metadata: {
      system: 'I-SPORTS v2.4',
      matchId: MATCH_INFO.matchId,
      tournament: MATCH_INFO.tournament,
      exportTimestamp: new Date().toISOString(),
      opticalTracking: 'ACTIVE',
      hawkEyeEngine: 'LOCKED',
      syncId: 'CQ-2026-F8',
    },
    summary: MATCH_INFO,
    players: {
      player1: PLAYER_1,
      player2: PLAYER_2,
    },
    rallies: RALLIES_DATA,
  };

  const jsonString = JSON.stringify(telemetryJsonData, null, 2);

  // Generate CSV text
  const csvHeaders = 'Rally_ID,Time_Range,Duration_Sec,Shots_Count,Avg_Speed_KMH,Max_Speed_KMH,Serve_Speed_KMH,Court_Status\n';
  const csvRows = RALLIES_DATA.map(
    (r) => `${r.id},"${r.timeRange}",${r.durationSeconds},${r.shotsCount},${r.avgSpeed},${r.maxSpeed},${r.serveSpeed},"${r.courtStatus}"`
  ).join('\n');
  const csvString = csvHeaders + csvRows;

  // Download handlers
  const handleDownloadJson = () => {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `I-SPORTS_Telemetry_${MATCH_INFO.matchId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `I-SPORTS_Telemetry_${MATCH_INFO.matchId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(activeTab === 'json' ? jsonString : csvString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#111624] border border-white/20 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 px-6 border-b border-white/10 flex items-center justify-between bg-[#0a0f1d]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-[#caf300]/10 border border-[#caf300]/30 flex items-center justify-center text-[#caf300]">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-white text-base font-bold">Xuất Dữ Liệu Báo Cáo Telemetry</h3>
              <p className="text-[11px] font-mono text-[#8f9bb3]">
                {MATCH_INFO.matchId} • {MATCH_INFO.totalRallies} Rallies • {MATCH_INFO.totalShots} Shots Tracked
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs & Action bar */}
        <div className="p-4 px-6 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 bg-[#0d1322]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('json')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold transition-colors ${
                activeTab === 'json'
                  ? 'bg-[#caf300] text-black font-bold'
                  : 'bg-white/5 text-[#94a3b8] hover:text-white'
              }`}
            >
              <FileJson className="w-3.5 h-3.5" />
              Định Dạng JSON
            </button>
            <button
              onClick={() => setActiveTab('csv')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold transition-colors ${
                activeTab === 'csv'
                  ? 'bg-[#caf300] text-black font-bold'
                  : 'bg-white/5 text-[#94a3b8] hover:text-white'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Định Dạng CSV (Excel)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white text-xs font-mono border border-white/10 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#caf300]" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Đã sao chép!' : 'Sao chép'}
            </button>

            {activeTab === 'json' ? (
              <button
                onClick={handleDownloadJson}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#caf300] hover:bg-[#d8ff14] text-black text-xs font-mono font-bold transition-all shadow-[0_0_12px_rgba(202,243,0,0.3)]"
              >
                <Download className="w-3.5 h-3.5" />
                Tải file .JSON
              </button>
            ) : (
              <button
                onClick={handleDownloadCsv}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#4cd7f6] hover:bg-[#68e0fc] text-black text-xs font-mono font-bold transition-all shadow-[0_0_12px_rgba(76,215,246,0.3)]"
              >
                <Download className="w-3.5 h-3.5" />
                Tải file .CSV
              </button>
            )}
          </div>
        </div>

        {/* Code / Text Viewer */}
        <div className="flex-1 p-4 px-6 overflow-y-auto bg-[#070b13] font-mono text-xs text-[#cbd5e1] select-all leading-relaxed max-h-[500px]">
          <pre className="whitespace-pre font-mono">
            {activeTab === 'json' ? jsonString : csvString}
          </pre>
        </div>

        {/* Footer */}
        <div className="p-3 px-6 border-t border-white/10 bg-[#0a0f1d] flex items-center justify-between text-[11px] font-mono text-[#718096]">
          <span>Xác thực bởi: Hawk-Eye Optical Synchronization Core</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
