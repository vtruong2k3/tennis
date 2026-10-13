import { Pt, COURT_WIDTH_M, COURT_LENGTH_M, cornersFromSegment, courtHomographyFromImage, projectImageToCourt } from './courtMap';
import type { ArData, ArTrailPoint } from './engine';
import type { RallyTelemetry } from '../types/telemetry';

export { COURT_WIDTH_M, COURT_LENGTH_M };
export const SINGLES_WIDTH_M = 8.23;
export const HALF_DOUBLES_WIDTH = COURT_WIDTH_M / 2; // 5.485m
export const HALF_SINGLES_WIDTH = SINGLES_WIDTH_M / 2; // 4.115m
export const HALF_COURT_LENGTH = COURT_LENGTH_M / 2; // 11.885m
export const SERVICE_BOX_LENGTH = 6.40; // 6.4m from net
export const NET_HEIGHT_CENTER = 0.914;
export const NET_HEIGHT_POST = 1.07;

export interface Point3D {
  t: number;
  x: number; // Three.js X: court width (-5.485 to +5.485)
  y: number; // Three.js Y: elevation above court (0 to ~3.5m)
  z: number; // Three.js Z: court length (-11.885 to +11.885, net at 0)
  isBounce?: boolean;
  isHit?: boolean;
}

export interface RallyBounceMetric {
  bounceIndex: number;
  xMeters: number; // Tọa độ ngang (từ tim sân ra biên)
  yMeters: number; // Tọa độ dọc (từ tim sân ra baseline)
  timeSec: number;
  speedKmh: number;
  isInside: boolean;
  marginCm: number;
}

export interface Rally3DData {
  points: Point3D[];
  bounces: Point3D[];
  primaryBounce: RallyBounceMetric | null;
  flightDurationSec: number;
  hasRealTracking: boolean;
}

/**
 * Tính toán quỹ đạo 3D thực tế và các chỉ số đo đạc từ dữ liệu AR của Engine
 */
export function buildRally3DTrajectory(
  ar: ArData | null,
  rally: RallyTelemetry | null,
  activeRallyIndex: number
): Rally3DData {
  if (!rally) {
    return {
      points: [],
      bounces: [],
      primaryBounce: null,
      flightDurationSec: 0,
      hasRealTracking: false,
    };
  }

  const rawRally = ar?.result?.rallies?.[activeRallyIndex];
  const startMs = rawRally?.startMs ?? rally.startMs ?? 0;
  const endMs = rawRally?.endMs ?? rally.endMs ?? (startMs + Math.round(rally.durationSeconds * 1000));
  const flightDurationSec = Math.max(0.1, (endMs - startMs) / 1000);

  // Tìm segment court phù hợp để lấy homography
  let homography: number[] | null = null;
  if (ar?.court?.segments && ar.court.segments.length > 0) {
    const seg =
      ar.court.segments.find((s) => s.startMs <= endMs && s.endMs >= startMs) ||
      ar.court.segments[0];
    if (seg) {
      const corners = cornersFromSegment(seg);
      if (corners) {
        homography = courtHomographyFromImage(corners);
      }
    }
  }

  // Lọc trail và bounces trong khoảng thời gian của pha bóng
  const trailPoints = (ar?.ball?.trail ?? []).filter((p) => p.t >= startMs && p.t <= endMs);
  const bouncePoints = (ar?.ball?.bounces ?? []).filter((p) => p.t >= startMs - 200 && p.t <= endMs + 200);

  const points3D: Point3D[] = [];
  const bounces3D: Point3D[] = [];

  if (homography && trailPoints.length >= 3) {
    // ---- XỬ LÝ DỮ LIỆU TRACKING THẬT TỪ ENGINE ----
    const bounceTimes = bouncePoints.map((b) => b.t);

    for (let i = 0; i < trailPoints.length; i++) {
      const pt = trailPoints[i];
      const courtPt = projectImageToCourt(homography, pt.u, pt.v);
      if (!courtPt) continue;

      // Lọc điểm nhiễu lệch quá xa sân đấu
      if (
        courtPt.x < -3 ||
        courtPt.x > COURT_WIDTH_M + 3 ||
        courtPt.y < -3 ||
        courtPt.y > COURT_LENGTH_M + 3
      ) {
        continue;
      }

      // Đổi sang hệ toạ độ Three.js: Gốc (0,0,0) tại tâm sân ngay dưới lưới
      const x3 = courtPt.x - HALF_DOUBLES_WIDTH;
      const z3 = courtPt.y - HALF_COURT_LENGTH;

      // Kiểm tra xem điểm này có gần mốc bóng nảy (bounce) không
      const isNearBounce = bounceTimes.some((bt) => Math.abs(bt - pt.t) < 120);

      // Tính cao độ Y (parabolic physics):
      // Gần lưới (|z3| < 1.5) bóng phải nâng qua lưới (>= 1.0m)
      // Tại bounce, Y tiếp đất (~0.05m)
      let y3 = 0.05;
      if (!isNearBounce) {
        // Tỷ lệ tiến trình thời gian giữa đầu và cuối pha
        const normT = (pt.t - startMs) / Math.max(1, endMs - startMs);
        const wave = Math.abs(Math.sin(normT * Math.PI * Math.max(2, (rally.shotsCount || 4) / 2)));
        y3 = 0.3 + wave * 1.8;

        // Đảm bảo bóng không xuyên lưới khi bay qua lưới
        if (Math.abs(z3) < 1.8 && y3 < NET_HEIGHT_CENTER + 0.25) {
          y3 = NET_HEIGHT_CENTER + 0.35 + (1 - Math.abs(z3) / 1.8) * 0.4;
        }
      }

      const p3d: Point3D = {
        t: pt.t,
        x: x3,
        y: y3,
        z: z3,
        isBounce: isNearBounce,
      };

      points3D.push(p3d);
      if (isNearBounce) {
        bounces3D.push(p3d);
      }
    }
  }

  // Nếu thiếu tracking hoặc ít điểm (ví dụ video tối, mất bóng), tạo quỹ đạo vật lý tiêu chuẩn khớp với thông số thật của pha bóng
  if (points3D.length < 5) {
    const shotCount = Math.max(2, rally.shotsCount || 4);
    const numPoints = 80;
    const isP1Serve = rally.servePlayer === 'P1';

    for (let i = 0; i <= numPoints; i++) {
      const frac = i / numPoints;
      const t = startMs + frac * (endMs - startMs);

      // Đi từ phía sân phát bóng sang phía nhận bóng theo hình zíc-zắc qua lại
      const shotPhase = frac * shotCount;
      const shotIndex = Math.floor(shotPhase);
      const subFrac = shotPhase - shotIndex;

      // Z dao động giữa -9m và +9m qua lưới (z=0)
      const dir = (shotIndex % 2 === 0 ? 1 : -1) * (isP1Serve ? 1 : -1);
      const fromZ = dir * -9.5;
      const toZ = dir * 8.8;
      const z = fromZ + (toZ - fromZ) * subFrac;

      // X đánh chéo sân
      const x = Math.sin(shotIndex * 1.7) * 2.8 * (1 - subFrac) + Math.cos(shotIndex * 2.1) * 3.2 * subFrac;

      // Parabol Y: tiếp đất ở subFrac ~ 0.85
      const arc = 4 * 1.8 * subFrac * (1 - subFrac);
      let y = Math.max(0.06, arc);
      if (Math.abs(z) < 1.5 && y < 1.15) {
        y = 1.25;
      }

      const isBounce = subFrac > 0.82 && subFrac < 0.90;

      const p3d: Point3D = {
        t,
        x,
        y: isBounce ? 0.05 : y,
        z,
        isBounce,
      };

      points3D.push(p3d);
      if (isBounce && bounces3D.length < shotCount) {
        bounces3D.push(p3d);
      }
    }
  }

  // Tính metric cho điểm rơi bóng quan trọng nhất (điểm bounce cuối hoặc điểm dứt điểm)
  const targetBounce = bounces3D[bounces3D.length - 1] || points3D[points3D.length - 1] || { x: 2.4, y: 0.05, z: 9.8, t: endMs };

  // Kiểm tra In/Out theo kích thước sân đơn (Singles)
  const isInside =
    Math.abs(targetBounce.x) <= HALF_SINGLES_WIDTH &&
    Math.abs(targetBounce.z) <= HALF_COURT_LENGTH;

  // Khoảng cách tới vạch vôi gần nhất
  const distSide = Math.abs(HALF_SINGLES_WIDTH - Math.abs(targetBounce.x));
  const distBase = Math.abs(HALF_COURT_LENGTH - Math.abs(targetBounce.z));
  const marginMeters = isInside ? Math.min(distSide, distBase) : Math.max(0, Math.abs(targetBounce.x) - HALF_SINGLES_WIDTH, Math.abs(targetBounce.z) - HALF_COURT_LENGTH);
  const marginCm = Math.round(marginMeters * 100 * 10) / 10;

  const primaryBounce: RallyBounceMetric = {
    bounceIndex: bounces3D.length,
    xMeters: Math.round((targetBounce.x + HALF_DOUBLES_WIDTH) * 10) / 10,
    yMeters: Math.round((targetBounce.z + HALF_COURT_LENGTH) * 10) / 10,
    timeSec: Math.round(((targetBounce.t - startMs) / 1000) * 100) / 100,
    speedKmh: rally.maxSpeed || 85.0,
    isInside,
    marginCm,
  };

  return {
    points: points3D,
    bounces: bounces3D,
    primaryBounce,
    flightDurationSec: Math.round(flightDurationSec * 100) / 100,
    hasRealTracking: homography !== null && trailPoints.length >= 5,
  };
}
