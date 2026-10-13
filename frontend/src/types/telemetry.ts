export interface RallyTelemetry {
  id: string; // e.g. "#01", "#13"
  rallyNumber: number;
  timeRange: string; // e.g. "00:00 - 00:10"
  durationSeconds: number; // e.g. 10.5
  startMs?: number; // mốc bắt đầu rally (ms tuyệt đối trong video)
  endMs?: number; // mốc kết thúc rally
  shotsCount: number;
  avgSpeed: number; // km/h
  maxSpeed: number; // km/h
  p1Speed?: number; // km/h (Tốc độ TB của VĐV 1 trong pha)
  p2Speed?: number; // km/h (Tốc độ TB của VĐV 2 trong pha)
  isRecord?: boolean;
  serveSpeed: number; // km/h
  servePlayer?: string;
  serveNote?: string; // e.g. "(P2 Max)"
  breakdown: {
    type: string;
    count: number;
    badgeClass?: string;
  }[];
  courtStatus: string; // e.g. "IN 100%"
  highlight?: boolean;
  startPos?: { x: number; y: number };
  endPos?: { x: number; y: number };
  peakSpeedPos?: { x: number; y: number };
  winner?: 'P1' | 'P2';
}

export interface PlayerStats {
  id: string;
  name: string;
  code: string;
  role: string;
  styleDescription: string;
  totalShots: number;
  shotsPercentage: number;
  avgSpeed: number;
  avgSpeedDiff?: string;
  maxServeSpeed: number;
  serveLabel?: string;
  distanceM?: number; // Quãng đường di chuyển (mét)
  leftSidePct?: number; // Tỷ lệ đứng nửa sân trái (%)
  dominantShotLabel: string;
  breakdown: {
    name: string;
    shots: number;
    percentage: number;
  }[];
}

export interface MatchSummary {
  matchId: string;
  title: string;
  status: string;
  tournament: string;
  totalShots: number;
  totalRallies: number;
  durationFormatted: string;
  avgShotsPerRally: number;
  recordRallyLength: number;
  recordRallies: string;
  peakBallSpeed: number;
  peakBallSpeedRally: string;
  peakBallSpeedTime: string;
  peakOverTourAvg: number;
  maxServeSpeed: number;
  maxServeP2: number;
  maxServeP1: number;
  avgMatchSpeed: number;
  speedDiffBetweenPlayers: number;
  kitchenControlP1: number;
  kitchenControlP2: number;
  baselineDepthP1: string;
  baselineDepthP2: string;
  serveHotspotZone: string;
  serveHotspotSpeed: number;
}
