import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize2,
  Film,
  Sparkles,
  Plus,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import { ArVideoLayer } from './ArVideoLayer';
import { useTelemetry } from '../api/TelemetryContext';
import { RallyTelemetry } from '../types/telemetry';
import { fetchArData, correctShot, ArTrailPoint } from '../api/engine';

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

interface VideoHudPlayerProps {
  selectedRally?: RallyTelemetry;
  onSelectRally?: (rally: RallyTelemetry) => void;
}

export const VideoHudPlayer: React.FC<VideoHudPlayerProps> = ({
  selectedRally,
  onSelectRally,
}) => {
  const { runId, runs, rallies: RALLIES_DATA, reload } = useTelemetry();
  const [selectedRallyIndex, setSelectedRallyIndex] = useState<number | null>(null);
  const [arShots, setArShots] = useState<ArTrailPoint[]>([]);
  const [activeShot, setActiveShot] = useState<ArTrailPoint | null>(null);
  const [editingShotType, setEditingShotType] = useState<string>('Forehand');
  const [editingPlayerId, setEditingPlayerId] = useState<number>(1);
  const [showAddShotModal, setShowAddShotModal] = useState<boolean>(false);
  const [newShotType, setNewShotType] = useState<string>('Forehand');
  const [newShotPlayerId, setNewShotPlayerId] = useState<number>(1);
  const [correcting, setCorrecting] = useState<boolean>(false);

  const videoUrl = useMemo(() => {
    if (!runId) return '';
    if (selectedRallyIndex !== null) {
      return `/internal/v1/test/runs/${runId}/video?rally=${selectedRallyIndex}`;
    }
    return `/internal/v1/test/runs/${runId}/video`;
  }, [runId, selectedRallyIndex]);

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

  // AR Overlay Filters toggles (mặc định BẬT để vẽ ngay đường bóng, sân AR, khung VĐV)
  const [showTrajectory, setShowTrajectory] = useState<boolean>(false);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState<boolean>(false);
  const [showKitchenZone, setShowKitchenZone] = useState<boolean>(false);
  const [showBounces, setShowBounces] = useState<boolean>(true);
  const [showFullTrajectory, setShowFullTrajectory] = useState<boolean>(false);

  // Time scrubber state
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);

  // Highlights sinh từ dữ liệu thật (result.json) của run đang chọn
  const highlights: HighlightItem[] = useMemo(() => {
    const toSec = (ms: number) => ms / 1000;
    const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}.${Math.floor((s % 1) * 100).toString().padStart(2, '0')}`;
    if (!RALLIES_DATA || RALLIES_DATA.length === 0) return [];
    const peak = RALLIES_DATA.length > 0
      ? RALLIES_DATA.reduce((m, r) => (r.maxSpeed > m.maxSpeed ? r : m), RALLIES_DATA[0])
      : undefined;
    const longest = RALLIES_DATA.length > 0
      ? RALLIES_DATA.reduce((m, r) => (r.shotsCount > m.shotsCount ? r : m), RALLIES_DATA[0])
      : undefined;
    const serveRallies = RALLIES_DATA.filter((r) => r.serveSpeed > 0);
    const bestServe = serveRallies.length > 0
      ? serveRallies.reduce((m, r) => (r.serveSpeed > m.serveSpeed ? r : m), serveRallies[0])
      : undefined;
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
  const DURATION_SEC = videoDuration || (RALLIES_DATA.length > 0 ? RALLIES_DATA.reduce((m, r) => Math.max(m, (r.endMs ?? 0) / 1000), 0) : 0) || 1;

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

  // Khi chọn rally từ bên ngoài (RalliesTable), tự động seek tới mốc thời gian đó trên video toàn trận
  useEffect(() => {
    if (selectedRally?.startMs != null) {
      if (selectedRallyIndex !== null) {
        setSelectedRallyIndex(null);
      }
      seekTo(selectedRally.startMs / 1000);
    }
  }, [selectedRally, seekTo]);

  // Nạp dữ liệu các cú đánh AR thật từ run hiện tại
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    fetchArData(runId, selectedRallyIndex ?? undefined)
      .then((data) => {
        if (!cancelled && data.ball?.shots) {
          setArShots(data.ball.shots);
        }
      })
      .catch(() => {
        if (!cancelled) setArShots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, selectedRallyIndex]);

  const handleSaveCorrection = async () => {
    if (!runId || !activeShot) return;
    setCorrecting(true);
    try {
      const frame = activeShot.frame ?? Math.round((activeShot.t / 1000) * 25);
      await correctShot(runId, {
        rally_index: selectedRallyIndex ?? 0,
        action: 'update',
        frame,
        shot_type: editingShotType,
        player_id: editingPlayerId,
      });
      setArShots((prev) =>
        prev.map((s) =>
          s.t === activeShot.t ? { ...s, shot_type: editingShotType, player: editingPlayerId } : s
        )
      );
      setActiveShot(null);
      reload();
    } catch (e) {
      console.error('Failed to correct shot:', e);
    } finally {
      setCorrecting(false);
    }
  };

  const handleDeleteShot = async () => {
    if (!runId || !activeShot) return;
    setCorrecting(true);
    try {
      const frame = activeShot.frame ?? Math.round((activeShot.t / 1000) * 25);
      await correctShot(runId, {
        rally_index: selectedRallyIndex ?? 0,
        action: 'delete',
        frame,
        shot_type: activeShot.shot_type || 'Forehand',
        player_id: activeShot.player || 1,
      });
      setArShots((prev) => prev.filter((s) => s.t !== activeShot.t));
      setActiveShot(null);
      reload();
    } catch (e) {
      console.error('Failed to delete shot:', e);
    } finally {
      setCorrecting(false);
    }
  };

  const handleAddNewShot = async () => {
    if (!runId) return;
    setCorrecting(true);
    try {
      const t = Math.round(currentTimeSec * 1000);
      const frame = Math.round(currentTimeSec * 25);
      await correctShot(runId, {
        rally_index: selectedRallyIndex ?? 0,
        action: 'add',
        frame,
        shot_type: newShotType,
        player_id: newShotPlayerId,
      });
      const newPt: ArTrailPoint = {
        t,
        u: 0.5,
        v: 0.5,
        frame,
        shot_type: newShotType,
        player: newShotPlayerId,
      };
      setArShots((prev) => [...prev, newPt].sort((a, b) => a.t - b.t));
      setShowAddShotModal(false);
      reload();
    } catch (e) {
      console.error('Failed to add shot:', e);
    } finally {
      setCorrecting(false);
    }
  };

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
            <p className="text-xs text-[#8f9bb3] mt-0.5 font-mono">
              {selectedRallyIndex === null
                ? '🎬 Đang phát: Toàn bộ video trận đấu (Full Match Timeline)'
                : `⚡ Đang xem chi tiết: Pha bóng #${selectedRallyIndex} (AI Telemetry Overlay)`}
            </p>
          </div>
        </div>

        {/* Rally / Full Match Mode Selector */}
        <div className="flex items-center gap-1.5 bg-[#080d19] p-1 rounded-lg border border-white/10 flex-wrap shrink-0">
          <button
            onClick={() => {
              setSelectedRallyIndex(null);
              if (RALLIES_DATA.length > 0) onSelectRally?.(RALLIES_DATA[0]);
              seekTo(0);
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-mono font-semibold transition-all flex items-center gap-1.5 ${
              selectedRallyIndex === null
                ? 'bg-[#caf300] text-black font-bold shadow-[0_0_12px_rgba(202,243,0,0.3)]'
                : 'text-[#8f9bb3] hover:text-white hover:bg-white/5'
            }`}
          >
            <span>🎬 Toàn Trận</span>
            {videoDuration > 0 && selectedRallyIndex === null && (
              <span className="text-[10px] opacity-80">({videoDuration.toFixed(0)}s)</span>
            )}
          </button>

          {RALLIES_DATA.map((r, idx) => {
            const rNum = idx + 1;
            const isSelected = selectedRallyIndex === rNum;
            return (
              <button
                key={r.id || idx}
                onClick={() => {
                  setSelectedRallyIndex(rNum);
                  onSelectRally?.(r);
                  seekTo(0);
                }}
                className={`px-2.5 py-1.5 rounded-md text-xs font-mono transition-all flex items-center gap-1 ${
                  isSelected
                    ? 'bg-[#4cd7f6] text-black font-bold shadow-[0_0_12px_rgba(76,215,246,0.35)]'
                    : 'text-[#8f9bb3] hover:text-white bg-white/5 hover:bg-white/10'
                }`}
              >
                <span>Pha {rNum}</span>
                <span className="text-[10px] opacity-75">({r.durationSeconds.toFixed(1)}s)</span>
              </button>
            );
          })}
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
                rallyId={selectedRallyIndex ?? undefined}
                videoRef={videoRef}
                showTrail={showTrajectory}
                showPlayers={showBoundingBoxes}
                showCourt={showKitchenZone}
                showKitchen={showKitchenZone}
                showBounces={showBounces}
                showFullTrajectory={showFullTrajectory}
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

          {/* Scrubber Timeline & Interactive Shot Markers */}
          <div className="bg-[#0b101c] rounded-lg p-3 border border-white/10 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between text-[11px] font-mono gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[#8f9bb3] font-semibold">
                  Timeline Cú Đánh (Interactive Shot Markers)
                </span>
                {arShots.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-[#caf300]/15 border border-[#caf300]/40 text-[#caf300] font-bold text-[10px]">
                    {arShots.length} cú đánh
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="flex items-center gap-1 text-[#ffd700]">
                  <span className="w-2 h-2 rounded-full bg-[#ffd700] shadow-[0_0_6px_#ffd700]"></span>
                  Giao Bóng (Serve)
                </span>
                <span className="flex items-center gap-1 text-[#caf300]">
                  <span className="w-2 h-2 rounded-full bg-[#caf300] shadow-[0_0_6px_#caf300]"></span>
                  Thuận Tay (FH)
                </span>
                <span className="flex items-center gap-1 text-[#4cd7f6]">
                  <span className="w-2 h-2 rounded-full bg-[#4cd7f6] shadow-[0_0_6px_#4cd7f6]"></span>
                  Trái Tay (BH)
                </span>
              </div>
            </div>

            {/* Human-in-the-loop: Edit Active Shot Card */}
            {activeShot && (
              <div className="bg-[#121927] border border-[#caf300]/50 rounded-lg p-2.5 shadow-xl flex flex-wrap items-center justify-between gap-2.5 transition-all">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#caf300] animate-pulse"></span>
                  <span className="text-white text-xs font-bold font-mono">
                    Sửa Cú Đánh {(activeShot.t / 1000).toFixed(2)}s (F{activeShot.frame ?? Math.round((activeShot.t / 1000) * 25)})
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap text-xs">
                  {/* Player Toggle */}
                  <div className="flex items-center gap-1 bg-[#0b101c] px-2 py-0.5 rounded border border-white/10">
                    <span className="text-[#8f9bb3] text-[10px]">VĐV:</span>
                    <button
                      onClick={() => setEditingPlayerId(1)}
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                        editingPlayerId === 1 ? 'bg-[#caf300] text-black' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      P1
                    </button>
                    <button
                      onClick={() => setEditingPlayerId(2)}
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                        editingPlayerId === 2 ? 'bg-[#4cd7f6] text-black' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      P2
                    </button>
                  </div>

                  {/* Shot Type Buttons */}
                  <div className="flex items-center gap-1 bg-[#0b101c] px-2 py-0.5 rounded border border-white/10">
                    <span className="text-[#8f9bb3] text-[10px]">Loại:</span>
                    {['Serve', 'Forehand', 'Backhand', 'Volley', 'Smash'].map((st) => (
                      <button
                        key={st}
                        onClick={() => setEditingShotType(st)}
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold transition-all ${
                          editingShotType.toLowerCase() === st.toLowerCase()
                            ? 'bg-white text-black shadow'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleSaveCorrection}
                    disabled={correcting}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#caf300] hover:bg-[#d8ff14] text-black text-xs font-bold transition-all disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Lưu</span>
                  </button>

                  <button
                    onClick={handleDeleteShot}
                    disabled={correcting}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/80 hover:bg-red-900 border border-red-500/50 text-red-300 text-xs font-bold transition-all disabled:opacity-50"
                    title="Xoá cú đánh này"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xoá</span>
                  </button>

                  <button
                    onClick={() => setActiveShot(null)}
                    className="p-1 rounded text-gray-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Human-in-the-loop: Add New Shot Card */}
            {showAddShotModal && (
              <div className="bg-[#121927] border border-[#4cd7f6]/50 rounded-lg p-2.5 shadow-xl flex flex-wrap items-center justify-between gap-2.5 transition-all">
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-[#4cd7f6]" />
                  <span className="text-white text-xs font-bold font-mono">
                    Thêm Cú Đánh Mới Tại {(currentTimeSec).toFixed(2)}s (F{Math.round(currentTimeSec * 25)})
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <div className="flex items-center gap-1 bg-[#0b101c] px-2 py-0.5 rounded border border-white/10">
                    <span className="text-[#8f9bb3] text-[10px]">VĐV:</span>
                    <button
                      onClick={() => setNewShotPlayerId(1)}
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                        newShotPlayerId === 1 ? 'bg-[#caf300] text-black' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      P1
                    </button>
                    <button
                      onClick={() => setNewShotPlayerId(2)}
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                        newShotPlayerId === 2 ? 'bg-[#4cd7f6] text-black' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      P2
                    </button>
                  </div>

                  <div className="flex items-center gap-1 bg-[#0b101c] px-2 py-0.5 rounded border border-white/10">
                    <span className="text-[#8f9bb3] text-[10px]">Loại:</span>
                    {['Serve', 'Forehand', 'Backhand', 'Volley', 'Smash'].map((st) => (
                      <button
                        key={st}
                        onClick={() => setNewShotType(st)}
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold transition-all ${
                          newShotType.toLowerCase() === st.toLowerCase()
                            ? 'bg-[#4cd7f6] text-black font-bold shadow'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleAddNewShot}
                    disabled={correcting}
                    className="flex items-center gap-1 px-3 py-1 rounded bg-[#4cd7f6] hover:bg-[#38bdf8] text-black text-xs font-bold transition-all disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Xác Nhận Thêm</span>
                  </button>

                  <button
                    onClick={() => setShowAddShotModal(false)}
                    className="p-1 rounded text-gray-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Audio Waveform / Segmented Bars + Interactive Markers Overlay */}
            <div
              className="h-11 bg-[#070b13] rounded border border-white/10 relative flex items-end px-2 gap-1 overflow-visible cursor-pointer select-none"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                seekTo(ratio * DURATION_SEC);
              }}
            >
              {/* Synthetic waveform vertical bars */}
              {Array.from({ length: 48 }).map((_, i) => {
                const isPeakZone = i >= 30 && i <= 34;
                const heightPct = isPeakZone ? 92 : ((Math.sin(i * 0.7) + 1.2) / 2.2) * 60 + 15;
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-t-sm transition-all pointer-events-none ${
                      isPeakZone
                        ? 'bg-[#caf300]/60'
                        : i % 4 === 0
                        ? 'bg-[#4cd7f6]/40'
                        : 'bg-[#94a3b8]/20'
                    }`}
                    style={{ height: `${heightPct}%` }}
                  ></div>
                );
              })}

              {/* Clickable Shot Markers */}
              {arShots.map((shot, idx) => {
                const shotSec = shot.t / 1000;
                const pct = Math.max(0, Math.min(100, (shotSec / DURATION_SEC) * 100));
                const sType = (shot.shot_type || '').toLowerCase();
                const isServe = sType.includes('serve');
                const isBackhand = sType.includes('backhand');
                const isForehand = sType.includes('forehand');
                const color = isServe ? '#ffd700' : isBackhand ? '#4cd7f6' : isForehand ? '#caf300' : '#f59e0b';
                const label = isServe ? 'S' : isBackhand ? 'BH' : isForehand ? 'FH' : '•';
                const isCurrentActive = activeShot?.t === shot.t;

                return (
                  <button
                    key={`${shot.t}-${idx}`}
                    style={{ left: `${pct}%` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      seekTo(shotSec);
                      setActiveShot(shot);
                      setEditingShotType(shot.shot_type || 'Forehand');
                      setEditingPlayerId(shot.player || 1);
                    }}
                    className={`absolute top-0 bottom-0 -translate-x-1/2 z-20 flex flex-col items-center justify-between group focus:outline-none py-0.5 ${
                      isCurrentActive ? 'scale-110 z-30' : ''
                    }`}
                    title={`Cú #${idx + 1}: ${shot.shot_type || 'Cú đánh'} (P${shot.player || 1}) tại ${shotSec.toFixed(2)}s - Click để sửa/xoá`}
                  >
                    <span
                      className="text-[9px] font-extrabold font-mono px-1 rounded shadow-md transition-transform group-hover:scale-125 border border-black/40"
                      style={{ backgroundColor: color, color: '#000000', boxShadow: `0 0 8px ${color}` }}
                    >
                      {label}
                    </span>
                    <span className="w-0.5 h-full opacity-80 group-hover:w-1 transition-all" style={{ backgroundColor: color }} />
                    <span
                      className="w-2 h-2 rounded-full border border-black transition-transform group-hover:scale-125"
                      style={{ backgroundColor: color }}
                    />
                  </button>
                );
              })}

              {/* Yellow Scrubber Needle / Playhead */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[#caf300] shadow-[0_0_12px_#caf300] pointer-events-none z-30"
                style={{ left: `${Math.min(100, (currentTimeSec / DURATION_SEC) * 100)}%` }}
              >
                <span className="absolute -top-2 -translate-x-1/2 bg-[#caf300] text-black text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shadow-lg border border-black/20">
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

              {/* Add Shot Button (Human-in-the-loop) */}
              <button
                onClick={() => setShowAddShotModal(true)}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#162032] hover:bg-[#caf300]/20 text-[#dfe2f1] hover:text-[#caf300] border border-white/10 hover:border-[#caf300]/50 text-xs font-mono font-semibold transition-all shadow-sm"
                title="Dừng video tại frame tiếp xúc và gắn nhãn cú đánh bị sót"
              >
                <Plus className="w-3.5 h-3.5 text-[#caf300]" />
                <span>+ Thêm Cú Đánh ({(currentTimeSec).toFixed(1)}s)</span>
              </button>

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
                  onClick={() => setShowBounces(!showBounces)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-all ${
                    showBounces
                      ? 'bg-[#caf300]/20 border-[#caf300] text-[#caf300] font-bold shadow-[0_0_8px_rgba(202,243,0,0.2)]'
                      : 'bg-white/5 border-white/10 text-[#64748b] opacity-60 hover:opacity-100'
                  }`}
                  title={showBounces ? 'Ẩn điểm nảy tiếp đất' : 'Hiện điểm nảy tiếp đất (Bounces)'}
                >
                  Điểm Nảy Sân
                </button>
                <button
                  onClick={() => setShowFullTrajectory(!showFullTrajectory)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-all ${
                    showFullTrajectory
                      ? 'bg-[#4cd7f6]/20 border-[#4cd7f6] text-[#4cd7f6] font-bold shadow-[0_0_8px_rgba(76,215,246,0.2)]'
                      : 'bg-white/5 border-white/10 text-[#64748b] opacity-60 hover:opacity-100'
                  }`}
                  title={showFullTrajectory ? 'Chuyển về đuôi bóng 1.0s' : 'Hiện toàn bộ đường bóng của pha'}
                >
                  Toàn Bộ Đường Bay
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
                  Khung Sân AR
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
              {filteredHighlights.length} PHA BÓNG
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
            {filteredHighlights.length === 0 ? (
              <div className="text-center py-8 text-[#8f9bb3] text-xs font-mono">
                Chưa có pha bóng highlight nào trong lượt chạy này.
              </div>
            ) : (
              filteredHighlights.map((item) => {
              const isSelected = selectedHighlightId === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setSelectedHighlightId(item.id);
                    if (selectedRallyIndex !== null) {
                      setSelectedRallyIndex(null);
                    }
                    // Seek thật tới mốc bắt đầu rally trong video toàn trận
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
            })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
