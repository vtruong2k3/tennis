import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize2,
  Film,
  Sparkles,
} from 'lucide-react';
import { ArVideoLayer } from './ArVideoLayer';
import { useTelemetry } from '../api/TelemetryContext';
import { RallyTelemetry } from '../types/telemetry';

interface HighlightItem {
  startMs: number;
  id: string;
  rallyNumber: string;
  badgeText: string;
  badgeColor: string;
  title: string;
  timeRange: string;
  durationFormatted: string;
  shotsCount: number;
  speed: string;
  speedCategory?: string;
  timecode: string;
  isPeak?: boolean;
  hasAr?: boolean;
}

export const VideoHudPlayer: React.FC = () => {
  const { runId, runs, rallies: RALLIES_DATA } = useTelemetry();
  const videoUrl = runId ? `/internal/v1/test/runs/${runId}/video` : '';
  // Trạng thái video của run đang chọn: server có file gốc không, và video có
  // khớp nguồn không (run cũ chỉ còn JSON có thể phát nhầm video khác).
  const currentRun = runs.find((r) => r.runId === runId);
  const videoMissing = currentRun?.hasVideo === false;
  const videoUnverified = currentRun?.videoVerified === false;
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [selectedHighlightId, setSelectedHighlightId] = useState<string>('13');
  const [filter, setFilter] = useState<'all' | 'high_speed' | 'long' | 'decisive'>('all');

  // AR Overlay Filters toggles (mặc định tắt, người dùng bấm mới bật)
  const [showTrajectory, setShowTrajectory] = useState<boolean>(false);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState<boolean>(false);
  const [showKitchenZone, setShowKitchenZone] = useState<boolean>(false);

  // Time scrubber state
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);

  // Highlights sinh từ dữ liệu thật (result.json) của run đang chọn
  const highlights: HighlightItem[] = useMemo(() => {
    const toSec = (ms: number) => ms / 1000;
    const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}.${Math.floor((s % 1) * 100).toString().padStart(2, '0')}`;
    const peak = RALLIES_DATA.reduce((m, r) => (r.maxSpeed > m.maxSpeed ? r : m), RALLIES_DATA[0]);
    const longest = RALLIES_DATA.reduce((m, r) => (r.shotsCount > m.shotsCount ? r : m), RALLIES_DATA[0]);
    const bestServe = RALLIES_DATA.filter((r) => r.serveSpeed > 0).reduce(
      (m, r) => (r.serveSpeed > m.serveSpeed ? r : m),
      RALLIES_DATA.find((r) => r.serveSpeed > 0) ?? RALLIES_DATA[0]
    );
    const list: HighlightItem[] = [];
    const seen = new Set<string>();
    const push = (r: RallyTelemetry, badge: string, color: string, title: string) => {
      if (!r || seen.has(r.id)) return;
      seen.add(r.id);
      list.push({
        id: r.id,
        rallyNumber: r.id,
        badgeText: badge,
        badgeColor: color,
        title,
        timeRange: r.timeRange,
        durationFormatted: `${r.durationSeconds.toFixed(1)}s`,
        shotsCount: r.shotsCount,
        speed: `${r.maxSpeed.toFixed(1)} km/h`,
        speedCategory: r.maxSpeed > 140 ? '>140' : undefined,
        timecode: fmt(toSec(r.startMs ?? 0)),
        startMs: r.startMs ?? 0,
        isPeak: r.highlight,
        hasAr: r.courtStatus !== 'N/A',
      });
    };
    if (peak) push(peak, 'KỶ LỤC TỐC ĐỘ', 'border-[#caf300] text-[#caf300]', `Kỷ lục tốc độ ${peak.maxSpeed.toFixed(1)} km/h - Cú đánh mạnh nhất trận`);
    if (bestServe && bestServe.serveSpeed > 0) push(bestServe, 'ACE GIAO BÓNG', 'border-[#4cd7f6] text-[#4cd7f6]', `Giao bóng mạnh nhất ${bestServe.serveSpeed.toFixed(1)} km/h`);
    if (longest) push(longest, 'RALLY DÀI NHẤT', 'border-[#f59e0b] text-[#f59e0b]', `Đại chiến bền bỉ ${longest.shotsCount} chạm`);
    RALLIES_DATA.filter((r) => r.maxSpeed > 140).slice(0, 2).forEach((r) => push(r, '>140 KM/H', 'border-[#4cd7f6] text-[#4cd7f6]', `Pha đập bóng ${r.maxSpeed.toFixed(1)} km/h`));
    const last = RALLIES_DATA[RALLIES_DATA.length - 1];
    if (last) push(last, 'PHÁ CUỐI', 'border-white/30 text-white/80', 'Pha bóng cuối cùng của trận');
    return list;
  }, [RALLIES_DATA]);

  // Tự động nhảy tới pha có AR đầu tiên khi mở video nếu pha hiện tại không có AR
  useEffect(() => {
    const firstAr = highlights.find((h) => h.hasAr);
    if (firstAr && (!highlights.some((h) => h.id === selectedHighlightId && h.hasAr))) {
      setSelectedHighlightId(firstAr.id);
      if (videoRef.current && firstAr.startMs > 0) {
        videoRef.current.currentTime = firstAr.startMs / 1000;
      }
    }
  }, [highlights]);

  const currentHighlight = highlights.find((h) => h.id === selectedHighlightId) || highlights[0];
  const DURATION_SEC = videoDuration || RALLIES_DATA.reduce((m, r) => Math.max(m, (r.endMs ?? 0) / 1000), 0) || 1;

  // Filtered highlights (dữ liệu thật)
  const filteredHighlights = highlights.filter((item) => {
    if (filter === 'high_speed') return item.speedCategory === '>140' || parseFloat(item.speed) > 140;
    if (filter === 'long') return item.shotsCount > 7;
    if (filter === 'decisive') return item.badgeText === 'PHÁ CUỐI' || item.isPeak;
    return true;
  });

  // Reset trạng thái lỗi khi đổi run.
  useEffect(() => {
    setVideoError(false);
  }, [videoUrl]);

  // Đọc thời gian thật từ <video> (thay cho timer ảo trước đây)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrentTimeSec(video.currentTime);
    const onLoaded = () => {
      setVideoDuration(video.duration || 0);
      setCurrentTimeSec(video.currentTime);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('durationchange', onLoaded);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    if (video.duration) setVideoDuration(video.duration);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('durationchange', onLoaded);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [videoUrl]);

  // Áp dụng tốc độ phát thật cho <video>.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackSpeed;
  }, [playbackSpeed, videoUrl]);

  // Play/Pause điều khiển video thật (đồng bộ qua sự kiện play/pause ở trên).
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, []);

  // Seek thật vào video
  const seekTo = useCallback((sec: number) => {
    const video = videoRef.current;
    if (video && Number.isFinite(sec)) {
      video.currentTime = Math.max(0, sec);
      setCurrentTimeSec(Math.max(0, sec));
    }
  }, []);


  return (
    <div className="bg-[#0e1320] border border-white/10 rounded-xl p-4 lg:p-6 shadow-2xl relative">
      {/* Section Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5 pb-3 border-b border-white/10">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-8 h-8 rounded bg-[#caf300]/15 border border-[#caf300]/40 flex items-center justify-center text-[#caf300] shrink-0 mt-0.5 sm:mt-0 shadow-[0_0_12px_rgba(202,243,0,0.25)]">
            <Film className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-white text-base lg:text-lg font-bold tracking-tight">
                Trình Phát Video Phân Tích & AR Telemetry HUD
              </h2>
              
            </div>
            
          </div>
        </div>

      </div>

      {/* Main Grid: Player on Left (7 cols) + Highlights on Right (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Video Screen + Controls */}
        <div className="lg:col-span-8 flex flex-col space-y-3">
          {/* Video Player Display Container */}
          <div className="relative w-full aspect-[16/9] min-h-[300px] bg-[#070b12] rounded-lg border border-white/10 overflow-hidden shadow-2xl select-none group">
            {/* Realistic Sports Court & Player/Racket Visual Canvas */}
            {/* Video thật + lớp AR overlay (sân / quỹ đạo bóng / VĐV) */}
            {!videoUrl ? (
              <div className="absolute inset-0 flex items-center justify-center text-[#8f9bb3] text-xs font-mono">
                Chưa có run nào được chọn
              </div>
            ) : videoMissing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#8f9bb3] text-xs font-mono px-6 text-center">
                <Film className="w-8 h-8 text-[#3d4a63]" />
                <span>Run này không còn video gốc trên engine.</span>
                <span className="text-[10px] text-[#5d6b85]">Video nằm trong bộ nhớ tạm của container đã bị xoá — kết quả JSON vẫn xem được ở các tab khác.</span>
              </div>
            ) : videoError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[#ef4444] text-xs font-mono px-6 text-center">
                <Film className="w-8 h-8 text-[#7f1d1d]" />
                <span>Không tải được video của run này từ engine.</span>
                <button
                  onClick={() => setVideoError(false)}
                  className="mt-1 px-3 py-1 rounded border border-white/15 text-[#dfe2f1] hover:border-[#4cd7f6] hover:text-[#4cd7f6] transition-colors"
                >
                  Thử lại
                </button>
              </div>
            ) : (
              <ArVideoLayer
                videoUrl={videoUrl}
                videoRef={videoRef}
                showTrail={showTrajectory}
                showPlayers={showBoundingBoxes}
                showCourt={showKitchenZone}
                showKitchen={showKitchenZone}
                onError={() => setVideoError(true)}
              />
            )}

            {/* Cảnh báo nguồn video không khớp nếu có */}
            {videoUnverified && !videoMissing && (
              <div className="absolute top-3 left-3 z-20">
                <span
                  title="Video này không khớp nguồn gốc đã ghi của run — có thể là video của trận khác"
                  className="px-2.5 py-1 rounded bg-amber-950/80 border border-amber-500/60 text-[10px] font-mono font-bold text-amber-400 backdrop-blur-md cursor-help"
                >
                  ⚠ VIDEO KHÔNG RÕ NGUỒN
                </span>
              </div>
            )}
          </div>

          {/* Scrubber Timeline & Rally Intensity Waveform */}
          <div className="bg-[#0b101c] rounded-lg p-3 border border-white/10 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[#8f9bb3] font-semibold">
                Scrubber Timeline (Rally Intensity Waveform)
              </span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-[#caf300]">
                  <span className="w-2 h-2 rounded-full bg-[#caf300]"></span>
                  Rally #13 (Peak)
                </span>
                <span className="flex items-center gap-1 text-[#4cd7f6]">
                  <span className="w-2 h-2 rounded-full bg-[#4cd7f6]"></span>
                  Rally #02 (Ace)
                </span>
              </div>
            </div>

            {/* Audio Waveform / Segmented Bars */}
            <div
              className="h-10 bg-[#070b13] rounded border border-white/5 relative flex items-end px-2 gap-1 overflow-hidden cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const ratio = clickX / rect.width;
                seekTo(ratio * DURATION_SEC);
              }}
            >
              {/* Synthetic waveform vertical bars */}
              {Array.from({ length: 48 }).map((_, i) => {
                // Peak around i = 32 (18 min mark)
                const isPeakZone = i >= 30 && i <= 34;
                const heightPct = isPeakZone ? 92 : ((Math.sin(i * 0.7) + 1.2) / 2.2) * 60 + 15;
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-t-sm transition-all ${
                      isPeakZone
                        ? 'bg-[#caf300] shadow-[0_0_8px_#caf300]'
                        : i % 4 === 0
                        ? 'bg-[#4cd7f6]/70'
                        : 'bg-[#94a3b8]/40'
                    }`}
                    style={{ height: `${heightPct}%` }}
                  ></div>
                );
              })}

              {/* Yellow Scrubber Needle / Playhead at 18:02 */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[#caf300] shadow-[0_0_10px_#caf300] pointer-events-none"
                style={{ left: `${Math.min(100, (currentTimeSec / DURATION_SEC) * 100)}%` }}
              >
                <span className="absolute -top-1 -translate-x-1/2 bg-[#caf300] text-black text-[9px] font-mono font-bold px-1 rounded shadow">
                  {Math.floor(currentTimeSec / 60)}:
                  {Math.floor(currentTimeSec % 60)
                    .toString()
                    .padStart(2, '0')}
                </span>
              </div>
            </div>

            {/* Playback Controls & AR Filters Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              {/* Media buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => seekTo(currentTimeSec - 5)}
                  className="w-8 h-8 rounded bg-[#162032] hover:bg-[#1f2d47] text-white flex items-center justify-center transition-colors border border-white/10"
                  title="Lùi 5 giây"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={togglePlay}
                  className="w-9 h-9 rounded bg-[#caf300] hover:bg-[#d8ff14] text-black font-bold flex items-center justify-center transition-all shadow-[0_0_12px_rgba(202,243,0,0.35)]"
                  title={isPlaying ? 'Tạm dừng' : 'Phát'}
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-black" /> : <Play className="w-4 h-4 fill-black translate-x-0.5" />}
                </button>

                <button
                  onClick={() => seekTo(currentTimeSec + 5)}
                  className="w-8 h-8 rounded bg-[#162032] hover:bg-[#1f2d47] text-white flex items-center justify-center transition-colors border border-white/10"
                  title="Tiến 5 giây"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Speed Selectors */}
              <div className="flex items-center gap-1 bg-[#101726] p-0.5 rounded border border-white/10">
                {[0.25, 0.5, 1.0].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setPlaybackSpeed(spd)}
                    className={`px-2 py-0.5 text-xs font-mono font-bold rounded transition-colors ${
                      playbackSpeed === spd
                        ? 'bg-[#caf300] text-black'
                        : 'text-[#94a3b8] hover:text-white'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>

              {/* AR Filters Switchers */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono text-[#718096] uppercase font-semibold">
                  AR FILTERS:
                </span>
                <button
                  onClick={() => setShowTrajectory(!showTrajectory)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-all ${
                    showTrajectory
                      ? 'bg-[#caf300]/20 border-[#caf300] text-[#caf300] font-bold shadow-[0_0_8px_rgba(202,243,0,0.2)]'
                      : 'bg-white/5 border-white/10 text-[#64748b] opacity-60 hover:opacity-100'
                  }`}
                  title={showTrajectory ? 'Ẩn quỹ đạo bóng' : 'Hiện quỹ đạo bóng'}
                >
                  Quỹ Đạo Bóng
                </button>
                <button
                  onClick={() => setShowBoundingBoxes(!showBoundingBoxes)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-all ${
                    showBoundingBoxes
                      ? 'bg-[#4cd7f6]/20 border-[#4cd7f6] text-[#4cd7f6] font-bold shadow-[0_0_8px_rgba(76,215,246,0.2)]'
                      : 'bg-white/5 border-white/10 text-[#64748b] opacity-60 hover:opacity-100'
                  }`}
                  title={showBoundingBoxes ? 'Ẩn bounding box VĐV' : 'Hiện bounding box VĐV'}
                >
                  Bounding Box VĐV
                </button>
                <button
                  onClick={() => setShowKitchenZone(!showKitchenZone)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-all ${
                    showKitchenZone
                      ? 'bg-white/15 border-white/40 text-white font-bold shadow-[0_0_8px_rgba(255,255,255,0.15)]'
                      : 'bg-white/5 border-white/10 text-[#64748b] opacity-60 hover:opacity-100'
                  }`}
                  title={showKitchenZone ? 'Ẩn khung phát bóng & vạch sân' : 'Hiện khung phát bóng & vạch sân'}
                >
                  Khung phát bóng
                </button>
              </div>

              {/* Fullscreen Button */}
              <button
                className="w-8 h-8 rounded bg-[#162032] hover:bg-[#1f2d47] text-[#94a3b8] hover:text-white flex items-center justify-center transition-colors border border-white/10"
                title="Toàn màn hình"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Video Highlights & Pha Tiêu Biểu */}
        <div className="lg:col-span-4 bg-[#0a0f1d] border border-white/10 rounded-xl p-4 flex flex-col justify-between shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
            <h3 className="text-white text-sm font-bold flex items-center gap-2">
              <Film className="w-4 h-4 text-[#caf300]" />
              Video Highlights
            </h3>
            <span className="bg-[#caf300] text-black text-[9px] font-mono font-black px-2 py-0.5 rounded uppercase">
              6 PHA BÓNG
            </span>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 mb-3 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded transition-colors ${
                filter === 'all'
                  ? 'bg-[#caf300] text-black shadow-sm'
                  : 'bg-white/5 text-[#94a3b8] hover:text-white'
              }`}
            >
              Tất Cả Highlights
            </button>
            <button
              onClick={() => setFilter('high_speed')}
              className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                filter === 'high_speed'
                  ? 'bg-[#caf300] text-black font-bold'
                  : 'bg-white/5 text-[#94a3b8] hover:text-white'
              }`}
            >
              &gt;140 km/h
            </button>
            <button
              onClick={() => setFilter('long')}
              className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                filter === 'long'
                  ? 'bg-[#caf300] text-black font-bold'
                  : 'bg-white/5 text-[#94a3b8] hover:text-white'
              }`}
            >
              &gt;7 Chạm
            </button>
            <button
              onClick={() => setFilter('decisive')}
              className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                filter === 'decisive'
                  ? 'bg-[#caf300] text-black font-bold'
                  : 'bg-white/5 text-[#94a3b8] hover:text-white'
              }`}
            >
              Điểm Quyết Định
            </button>
          </div>

          {/* Highlights List */}
          <div className="space-y-2.5 overflow-y-auto max-h-[460px] pr-1">
            {filteredHighlights.map((item) => {
              const isSelected = selectedHighlightId === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setSelectedHighlightId(item.id);
                    // Seek thật tới mốc bắt đầu rally trong video
                    seekTo(item.startMs / 1000);
                    videoRef.current?.play();
                    setIsPlaying(true);
                  }}
                  className={`p-3 rounded-lg border cursor-pointer transition-all duration-150 ${
                    isSelected
                      ? 'bg-[#18230f] border-[#caf300] shadow-[0_0_12px_rgba(202,243,0,0.2)]'
                      : 'bg-[#0f1523] border-white/5 hover:border-white/20'
                  }`}
                >
                  {/* Top tags line */}
                  <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-bold ${isSelected ? 'text-[#caf300]' : 'text-white'}`}>
                        {item.rallyNumber}
                      </span>
                      {isSelected && (
                        <span className="text-[#caf300] text-[10px] font-bold animate-pulse">
                          ● ĐANG PHÁT
                        </span>
                      )}
                      {item.hasAr && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#4cd7f6]/15 border border-[#4cd7f6]/50 text-[#4cd7f6]">
                          ⚡ AR READY
                        </span>
                      )}
                    </div>

                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase ${item.badgeColor}`}>
                      {item.badgeText}
                    </span>
                  </div>

                  {/* Title */}
                  <h4 className="text-white text-xs font-bold leading-snug my-1 line-clamp-1">
                    {item.title}
                  </h4>

                  {/* Subtitle footer */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-[#8f9bb3] mt-1.5 pt-1.5 border-t border-white/5">
                    <span>{item.timeRange}</span>
                    <span className={item.isPeak ? 'text-[#caf300] font-bold' : 'text-[#4cd7f6]'}>
                      {item.shotsCount} cú chạm · {item.speed}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
