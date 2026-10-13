// Toạ độ học cho card "Mô Phỏng Sân Đấu & AR Court Tracking".
// Đầu vào: 4 góc sân (chuẩn hoá [0..1]) từ ar-court/segments/lines/outline,
// đầu ra: ánh xạ hệ mét của sân (x ngang 0..10.97, y dọc 0..23.77) sang toạ độ SVG.

import type { ArCourtSegment } from './engine';

// Kích thước sân đôi chuẩn — PHẢI khớp worker/court.py.
export const COURT_WIDTH_M = 10.97;
export const COURT_LENGTH_M = 23.77;
export const SINGLES_INSET_M = 1.37; // viền đơn trong cách viền đôi.
export const SERVICE_FROM_NET_M = 6.4;
export const HEAT_BINS_X = 22;
export const HEAT_BINS_Y = 48;

export interface Pt {
  x: number;
  y: number;
}

// Trích 4 góc sân từ outline của segment (polygon khép kín, có thể trùng điểm cuối).
export function cornersFromSegment(seg: ArCourtSegment): [Pt, Pt, Pt, Pt] | null {
  const outline = seg.lines?.outline;
  if (!outline || outline.length === 0) return null;
  let poly = outline[0];
  if (poly.length < 4) return null;
  // Bỏ điểm cuối nếu trùng điểm đầu (polygon khép kín).
  const first = poly[0];
  const last = poly[poly.length - 1];
  if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
    poly = poly.slice(0, -1);
  }
  if (poly.length !== 4) return null;
  // Chuẩn: TL, TR, BR, BL.
  const pts: [Pt, Pt, Pt, Pt] = [
    { x: poly[0][0], y: poly[0][1] },
    { x: poly[1][0], y: poly[1][1] },
    { x: poly[2][0], y: poly[2][1] },
    { x: poly[3][0], y: poly[3][1] },
  ];
  return pts;
}

// ---- Homography ảnh (u,v chuẩn hoá) -> sân (x mét ngang, y mét dọc) ----
// worker/court.py đặt 4 góc sân (TL,TR,BR,BL ảnh) tương ứng
// (0,0),(W,0),(W,L),(0,L) mét. Ta cần chiều ngược: giải hệ 8 ẩn (h8 = 1).
function solve8(rows: number[][]): number[] | null {
  const n = 8;
  const a = rows.map((r) => r.slice());
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const scale = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= scale;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      for (let j = col; j <= n; j++) a[r][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

// Mét sang chuẩn hoá ảnh rồi ngược lại: làm việc trực tiếp trên uv [0..1].
// src = góc sân theo mét (0,0),(W,0),(W,L),(0,L); dst = uv ảnh.
export function courtHomographyFromImage(corners: [Pt, Pt, Pt, Pt]): number[] | null {
  const W = COURT_WIDTH_M;
  const L = COURT_LENGTH_M;
  const src: [number, number][] = [
    [0, 0],
    [W, 0],
    [W, L],
    [0, L],
  ];
  const dst: [number, number][] = corners.map((p) => [p.x, p.y]);
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  return solve8(rows);
}

// Chiếu điểm sân (mét) -> ảnh (u,v chuẩn hoá).
export function projectCourtToImage(h: number[], x: number, y: number): Pt | null {
  const w = h[6] * x + h[7] * y + 1;
  if (Math.abs(w) < 1e-9) return null;
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

// Chiếu điểm ảnh (u,v) -> sân (mét) bằng nghịch đảo homography (adjugate 3x3).
// [x', y', w'] = adj(H) · [u, v, 1];  (x, y) = (x'/w', y'/w')
export function projectImageToCourt(h: number[], u: number, v: number): Pt | null {
  const a = h[0], b = h[1], c = h[2];
  const d = h[3], e = h[4], f = h[5];
  const g = h[6], i = h[7]; // h8 = 1
  const A = e - f * i, B = c * i - b, C = b * f - c * e;
  const D = f * g - d, E = a - c * g, F = c * d - a * f;
  const G = d * i - e * g, H = b * g - a * i, I = a * e - b * d;
  const w = G * u + H * v + I;
  if (Math.abs(w) < 1e-12) return null;
  return { x: (A * u + B * v + C) / w, y: (D * u + E * v + F) / w };
}

// ---- Vẽ sân lên SVG ----

export interface CourtSvgView {
  // Hệ toạ độ SVG viewBox [0..VW]x[0..VH]: sân chiếm margin..(VW-margin)/(VH-..)
  map: (xM: number, yM: number) => Pt; // sân mét -> SVG
  inv: (u: number, v: number) => Pt | null; // ảnh uv -> sân mét (hoặc null nếu ngoài homography)
}

export function buildCourtView(
  h: number[],
  box: { x: number; y: number; w: number; hgt: number }
): CourtSvgView {
  // Sân top-down phủ kín box, xoay ngang: chiều DÀI sân (y mét) chạy theo chiều ngang
  // box (P0 giữa y=0..net nằm bên TRÁI), chiều RỘNG (x mét) theo chiều cao box.
  const map = (xM: number, yM: number): Pt => ({
    x: box.x + (yM / COURT_LENGTH_M) * box.w,
    y: box.y + (xM / COURT_WIDTH_M) * box.hgt,
  });
  // Ảnh (uv chuẩn hoá) -> sân mét qua homography dựng từ 4 góc sân thật.
  const inv = (u: number, v: number): Pt | null => projectImageToCourt(h, u, v);
  return { map, inv };
}

// ---- Metrics từ dữ liệu thật (heatmap đã ở hệ mét sân) ----

export interface PlayerMetrics {
  side: 'top' | 'bottom'; // phía sân VĐV chiếm nhiều thời gian hơn (y=0 là 'top')
  kitchenPct: number; // % thời gian giữa service line và lưới (vùng tấn công)
  baselineDepthM: number; // khoảng cách trung bình tới baseline phía mình (m)
  totalSamples: number; // tổng số mẫu (để biết heatmap có dữ liệu không)
}

// Tính metrics một VĐV từ heatmap cells [bx, by, count] — không cần homography.
export function computePlayerMetrics(cells: number[][] | undefined): PlayerMetrics {
  const net = COURT_LENGTH_M / 2;
  let topCount = 0;
  let bottomCount = 0;
  for (const [bx, by, count] of cells ?? []) {
    const cy = ((by + 0.5) / HEAT_BINS_Y) * COURT_LENGTH_M;
    if (cy < net) topCount += count;
    else bottomCount += count;
  }
  const side: 'top' | 'bottom' = bottomCount >= topCount ? 'bottom' : 'top';

  let kitchen = 0;
  let total = 0;
  let depthSum = 0;
  for (const [bx, by, count] of cells ?? []) {
    const cy = ((by + 0.5) / HEAT_BINS_Y) * COURT_LENGTH_M;
    if (cy < -2 || cy > COURT_LENGTH_M + 2) continue; // ô nhiễu ngoài sân ±2m
    total += count;
    // Vùng kitchen của VĐV: từ service line phía mình tới lưới.
    const inKitchen =
      side === 'top'
        ? cy >= net - SERVICE_FROM_NET_M && cy <= net
        : cy >= net && cy <= net + SERVICE_FROM_NET_M;
    if (inKitchen) kitchen += count;
    const baselineY = side === 'top' ? 0 : COURT_LENGTH_M;
    depthSum += Math.abs(cy - baselineY) * count;
  }
  return {
    side,
    kitchenPct: total ? Math.round((100 * kitchen) / total) : 0,
    baselineDepthM: total ? Math.round((depthSum / total) * 10) / 10 : 0,
    totalSamples: total,
  };
}

// Ramp nhiệt họ NÓNG thuần (đỏ -> cam -> vàng) — cùng một họ màu nên các ô
// hoà vào nhau liền mạch, không rời rạc; đậm nhạt + độ sáng mã hoá cường độ:
// thẫm đỏ (thấp) -> đỏ -> cam -> vàng rực (cao).
const HEAT_STOPS: [number, [number, number, number]][] = [
  [0.0, [122, 22, 22]],
  [0.4, [229, 57, 34]],
  [0.7, [255, 122, 24]],
  [1.0, [255, 214, 64]],
];

export function heatRampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t1, c1] = HEAT_STOPS[i];
    const [t0, c0] = HEAT_STOPS[i - 1];
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      const rgb = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
  }
  return `rgb(${HEAT_STOPS[HEAT_STOPS.length - 1][1].join(', ')})`;
}

// Tìm ô nóng nhất của một VĐV từ heatmap cells [bx, by, count].
export function hottestCell(cells: number[][] | undefined): { bx: number; by: number; count: number } | null {
  if (!cells || cells.length === 0) return null;
  let best = cells[0];
  for (const c of cells) {
    if (c[2] > best[2]) best = c;
  }
  return { bx: best[0], by: best[1], count: best[2] };
}

// Trọng tâm vùng hoạt động của VĐV từ heatmap (theo mét).
export function heatCentroid(cells: number[][] | undefined): Pt | null {
  if (!cells || cells.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const [bx, by, count] of cells) {
    const cx = ((bx + 0.5) / HEAT_BINS_X) * COURT_WIDTH_M;
    const cy = ((by + 0.5) / HEAT_BINS_Y) * COURT_LENGTH_M;
    sx += cx * count;
    sy += cy * count;
    sw += count;
  }
  if (!sw) return null;
  return { x: sx / sw, y: sy / sw };
}
