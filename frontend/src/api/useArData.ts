import { useEffect, useState } from 'react';
import { ArData, fetchArData, fetchRunFile } from './engine';

export interface HeatmapData {
  bins: { x: number; y: number };
  players: { playerIndex: number; cells: number[][] }[];
}

// Nạp dữ liệu AR (court/ball/players/result) + heatmap.json theo runId.
// Trả null khi chưa có (run chưa xong) — component dùng fallback mock.
export function useArData(runId: string | null): ArData | null {
  const [ar, setAr] = useState<ArData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAr(null);
    if (!runId) return;
    (async () => {
      try {
        const data = await fetchArData(runId);
        if (cancelled) return;
        setAr(data);
      } catch {
        if (!cancelled) setAr(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return ar;
}

export async function fetchHeatmap(runId: string): Promise<HeatmapData | null> {
  try {
    return await fetchRunFile<HeatmapData>(runId, 'heatmap.json');
  } catch {
    return null;
  }
}
