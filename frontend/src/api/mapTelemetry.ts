import { MatchSummary, PlayerStats, RallyTelemetry } from '../types/telemetry';

// ----- Schema thô từ result.json của engine -----
export interface EnginePlayer {
  playerIndex: number;
  shotCount: number;
  shotTypes: Record<string, number>;
  avgShotSpeedKmh?: number;
  serveSpeedKmh?: number;
  distanceM?: number;
  leftSidePct?: number;
}

export interface EngineRally {
  startMs: number;
  endMs: number;
  shotCount: number;
  shotTypes?: Record<string, number>;
  court?: boolean;
  avgShotSpeedKmh?: number;
  maxFlightSpeedKmh?: number;
  serveSpeedKmh?: number;
  players?: { playerIndex: number; avgShotSpeedKmh?: number; shotCount?: number }[];
}

export interface EngineResult {
  players?: EnginePlayer[];
  rallies?: EngineRally[];
}

// ----- Nhãn & màu badge theo loại cú đánh -----
const SHOT_LABELS: Record<string, string> = {
  Forehand: 'Thuận Tay',
  Backhand: 'Trái Tay',
  Groundstroke: 'Cú Nền',
  Serve: 'Giao Bóng',
  Volley: 'Bóng Trôi',
  Smash: 'Smash',
};

const BADGES: Record<string, string> = {
  Forehand: 'bg-[#1b253b] text-[#4cd7f6] border border-[#2d3e5e]',
  Backhand: 'bg-[#1e2e2b] text-[#86efac] border border-[#244e3d]',
  Serve: 'bg-[#1f2937] text-white border border-[#374151]',
  Groundstroke: 'bg-[#1a2333] text-[#a0aec0] border border-[#273549]',
};

const badgeOf = (type: string) => BADGES[type] ?? 'bg-[#1a2333] text-[#a0aec0] border border-[#273549]';
const labelOf = (type: string) => SHOT_LABELS[type] ?? type;
const round1 = (n: number) => Math.round(n * 10) / 10;

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export interface MappedTelemetry {
  match: MatchSummary;
  players: PlayerStats[];
  rallies: RallyTelemetry[];
}

export function mapTelemetry(result: EngineResult, runId: string): MappedTelemetry {
  const overallP0 = result.players?.[0]?.avgShotSpeedKmh ?? 83.0;
  const overallP1 = result.players?.[1]?.avgShotSpeedKmh ?? 83.8;
  const overallMean = (overallP0 + overallP1) / 2 || 1;

  // ----- Rallies -----
  const rallies: RallyTelemetry[] = (result.rallies ?? []).map((r, i) => {
    const p0Data = r.players?.find((p) => p.playerIndex === 0);
    const p1Data = r.players?.find((p) => p.playerIndex === 1);
    const rallyAvg = r.avgShotSpeedKmh ?? overallMean;
    const scale = overallMean > 0 ? rallyAvg / overallMean : 1;

    const p1Speed = p0Data?.avgShotSpeedKmh != null
      ? round1(p0Data.avgShotSpeedKmh)
      : round1(overallP0 * scale);
    const p2Speed = p1Data?.avgShotSpeedKmh != null
      ? round1(p1Data.avgShotSpeedKmh)
      : round1(overallP1 * scale);

    return {
      id: `#${String(i + 1).padStart(2, '0')}`,
      rallyNumber: i + 1,
      timeRange: `${fmtClock(r.startMs)} - ${fmtClock(r.endMs)}`,
      durationSeconds: round1((r.endMs - r.startMs) / 1000),
      startMs: r.startMs,
      endMs: r.endMs,
      shotsCount: r.shotCount ?? 0,
      avgSpeed: round1(r.avgShotSpeedKmh ?? 0),
      maxSpeed: round1(r.maxFlightSpeedKmh ?? 0),
      p1Speed,
      p2Speed,
      serveSpeed: round1(r.serveSpeedKmh ?? 0),
      breakdown: Object.entries(r.shotTypes ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count, badgeClass: badgeOf(type) })),
      courtStatus: r.court === false ? 'N/A' : 'IN 100%',
    };
  });

  const recordShots = rallies.reduce((m, r) => Math.max(m, r.shotsCount), 0);
  rallies.forEach((r) => {
    if (r.shotsCount === recordShots) {
      r.isRecord = true;
      r.highlight = true;
    }
  });

  // ----- Players -----
  const players: PlayerStats[] = (result.players ?? []).slice(0, 2).map((p, i) => {
    const entries = Object.entries(p.shotTypes ?? {}).sort((a, b) => b[1] - a[1]);
    const dominant = entries[0]?.[0] ?? '';
    const shotTotal = p.shotCount || entries.reduce((s, [, c]) => s + c, 0) || 1;
    const allShotTotal = playersShotTotal(result);
  return {
      id: `P${i + 1}`,
      code: `P${i + 1}`,
      name: `VĐV ${i + 1}`,
      role: `VĐV ${i + 1}`,
      styleDescription: dominant ? `${labelOf(dominant).toUpperCase()}-DOMINANT` : 'KHÔNG XÁC ĐỊNH',
      totalShots: p.shotCount ?? 0,
      shotsPercentage: round1(((p.shotCount ?? 0) / Math.max(1, allShotTotal)) * 100),
      avgSpeed: round1(p.avgShotSpeedKmh ?? 0),
      maxServeSpeed: round1(p.serveSpeedKmh ?? 0),
      distanceM: p.distanceM != null ? round1(p.distanceM) : undefined,
      leftSidePct: p.leftSidePct != null ? round1(p.leftSidePct) : undefined,
      dominantShotLabel: labelOf(dominant),
      breakdown: entries.map(([type, count]) => ({
        name: `${labelOf(type)} (${count} cú)`,
        shots: count,
        percentage: round1((count / shotTotal) * 100),
      })),
    };
  });

  // ----- Match summary -----
  const rawShotTotal = playersShotTotal(result);
  const serves = (result.players ?? []).map((p) => p.serveSpeedKmh ?? 0);
  const peak =
    rallies.length > 0
      ? rallies.reduce((m, r) => (r.maxSpeed > m.maxSpeed ? r : m), rallies[0])
      : null;
  const avgSpeedAll =
    rawShotTotal > 0
      ? (result.players ?? []).reduce((s, p) => s + (p.avgShotSpeedKmh ?? 0) * (p.shotCount ?? 0), 0) / rawShotTotal
      : 0;
  const totalMs = (result.rallies ?? []).reduce((s, r) => s + Math.max(0, (r.endMs ?? 0) - (r.startMs ?? 0)), 0);
  const durMin = Math.floor(totalMs / 60000);
  const durSec = Math.round((totalMs % 60000) / 1000);
  const recordIds = rallies.filter((r) => r.isRecord).map((r) => r.id).join(' & ');
  const avgP0 = result.players?.[0]?.avgShotSpeedKmh ?? 0;
  const avgP1 = result.players?.[1]?.avgShotSpeedKmh ?? 0;

  const match: MatchSummary = {
    matchId: `#${runId}`,
    title: 'TENNIS ENGINE · PHÂN TÍCH VIDEO THẬT',
    status: 'ANALYZED',
    tournament: 'LOCAL ENGINE ANALYSIS',
    totalShots: rawShotTotal,
    totalRallies: rallies.length,
    durationFormatted: `${durMin}:${String(durSec).padStart(2, '0')} phút`,
    avgShotsPerRally: rallies.length ? round1(rawShotTotal / rallies.length) : 0,
    recordRallyLength: recordShots,
    recordRallies: recordIds || '—',
    peakBallSpeed: peak?.maxSpeed ?? 0,
    peakBallSpeedRally: peak?.id ?? '—',
    peakBallSpeedTime: peak?.timeRange ?? '—',
    peakOverTourAvg: round1((peak?.maxSpeed ?? 0) - avgSpeedAll),
    maxServeSpeed: serves.length ? round1(Math.max(...serves)) : 0,
    maxServeP1: round1(serves[0] ?? 0),
    maxServeP2: round1(serves[1] ?? 0),
    avgMatchSpeed: round1(avgSpeedAll),
    speedDiffBetweenPlayers: round1(Math.abs(avgP0 - avgP1)),
    // Engine chưa xuất các chỉ số này (cần heatmap/ar-players) — đặt trung tính.
    kitchenControlP1: 50,
    kitchenControlP2: 50,
    baselineDepthP1: '—',
    baselineDepthP2: '—',
    serveHotspotZone: '—',
    serveHotspotSpeed: serves.length ? round1(Math.max(...serves)) : 0,
  };

  return { match, players, rallies };
}

function playersShotTotal(result: EngineResult): number {
  return (result.players ?? []).reduce((s, p) => s + (p.shotCount ?? 0), 0);
}
