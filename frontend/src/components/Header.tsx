import React from 'react';
import { Download, User, RefreshCw, ChevronDown, Database } from 'lucide-react';

export interface RunOption {
  runId: string;
  status: string;
  files: string[];
  hasVideo?: boolean;
  videoVerified?: boolean;
}

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenExport: () => void;
  runs: RunOption[];
  currentRunId: string | null;
  onSelectRun: (runId: string) => void;
  onReloadRuns: () => void;
  loading?: boolean;
  matchId?: string;
  totalRallies?: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenExport,
  runs,
  currentRunId,
  onSelectRun,
  onReloadRuns,
  loading = false,
}) => {
  const tabs = [
    { id: 'overview', label: 'Tổng Quan' },
    { id: 'video', label: 'Video & AR HUD' },
    { id: 'telemetry', label: 'Telemetry & Tốc Độ' },
    { id: 'rally', label: 'Phân Tích Rally' },
    { id: 'court', label: 'Sơ Đồ Sân (AR)' },
    { id: 'analyze', label: 'Phân Tích Mới' },
  ];

  return (
    <header className="w-full bg-[#0a0e17] border-b border-white/10 select-none">
      {/* Main Top Navigation Bar */}
      <div className="max-w-[1700px] mx-auto px-4 lg:px-6 flex items-center justify-between min-h-[64px] gap-4">
        {/* Brand & Subtitle + Live Badge right next to it */}
        <div className="flex items-center gap-3 py-2 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-[#121927] border border-[#caf300]/40 flex items-center justify-center relative shadow-[0_0_12px_rgba(202,243,0,0.2)]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L3 7V17L12 22L21 17V7L12 2Z" stroke="#caf300" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 6V18" stroke="#4cd7f6" strokeWidth="1.5" strokeDasharray="2 2"/>
              <circle cx="12" cy="12" r="3.2" fill="#caf300" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-white font-extrabold text-base tracking-wider leading-tight">
              I-SPORTS
            </span>
            <span className="text-[#4cd7f6] text-[10px] font-mono tracking-widest font-semibold uppercase">
              OPTICAL TELEMETRY V2.4
            </span>
          </div>

          {/* Live Badge right next to logo */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#caf300]/15 border border-[#caf300]/30 text-[#caf300] font-bold text-[11px] font-mono ml-1.5 shadow-[0_0_10px_rgba(202,243,0,0.15)] animate-pulse">
            <span className="w-2 h-2 rounded-full bg-[#caf300] shadow-[0_0_6px_#caf300]"></span>
            LIVE
          </span>
        </div>

        {/* Center Navigation Bar */}
        <nav className="hidden md:flex items-center gap-1 bg-[#111827]/70 p-1 rounded-xl border border-white/10 shadow-inner">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-all duration-150 ${
                  isActive
                    ? 'bg-[#caf300] text-[#0a0e18] font-bold shadow-[0_0_12px_rgba(202,243,0,0.3)]'
                    : 'text-[#9ca3af] hover:text-white hover:bg-white/5'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Right Navigation & Actions */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Run Selector — xem kết quả các lần phân tích cũ */}
          <div className="hidden lg:flex items-center gap-1.5 bg-[#111827] border border-white/10 rounded-lg px-2.5 py-1.5">
            <Database className="w-3.5 h-3.5 text-[#8f9bb3]" />
            <div className="relative">
              <select
                value={currentRunId ?? ''}
                onChange={(e) => onSelectRun(e.target.value)}
                disabled={loading || runs.length === 0}
                title="Chọn lần phân tích để xem kết quả"
                className="appearance-none bg-transparent text-[11px] font-mono text-[#dfe2f1] pr-5 cursor-pointer hover:text-[#4cd7f6] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed max-w-[200px]"
              >
                {runs.length === 0 && <option value="" className="bg-[#111827]">Không có run nào</option>}
                {runs.map((run) => (
                  <option key={run.runId} value={run.runId} disabled={run.status !== 'COMPLETED'} className="bg-[#111827]">
                    {run.runId}
                    {run.status !== 'COMPLETED' ? ' — chưa có kết quả' : run.hasVideo === false ? ' — không có video' : run.videoVerified === false ? ' — video không rõ nguồn' : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-[#8f9bb3] absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <button
              onClick={onReloadRuns}
              title="Tải lại danh sách run"
              className="p-1 rounded text-[#8f9bb3] hover:text-[#4cd7f6] transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Export Data Button */}
          <button
            onClick={onOpenExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-transparent border border-white/15 text-[#dfe2f1] hover:border-[#4cd7f6] hover:text-[#4cd7f6] text-xs font-semibold tracking-wider transition-colors uppercase whitespace-nowrap shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">EXPORT DATA</span>
          </button>

          {/* Profile Avatar */}
          <div className="w-8 h-8 rounded-full border border-white/20 bg-[#121927] flex items-center justify-center text-white/70 hover:border-white/40 cursor-pointer transition-colors">
            <User className="w-4 h-4" />
          </div>
        </div>
      </div>

    </header>
  );
};
