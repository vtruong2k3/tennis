import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { MatchSummary, PlayerStats, RallyTelemetry } from '../types/telemetry';
import { MATCH_INFO, PLAYER_1, PLAYER_2, RALLIES_DATA } from '../data/telemetryData';
import { EngineRun, fetchRunFile, listRuns } from './engine';
import { mapTelemetry, EngineResult } from './mapTelemetry';

interface TelemetryState {
  loading: boolean;
  source: 'live' | 'mock';
  runId: string | null;
  runs: EngineRun[];
  match: MatchSummary;
  players: PlayerStats[];
  rallies: RallyTelemetry[];
  p1Handedness: 'right' | 'left';
  p2Handedness: 'right' | 'left';
  setP1Handedness: (h: 'right' | 'left') => void;
  setP2Handedness: (h: 'right' | 'left') => void;
  reload: () => void;
  selectRun: (runId: string) => void;
}

const TelemetryContext = createContext<TelemetryState | null>(null);

export const useTelemetry = (): TelemetryState => {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetry phải dùng trong TelemetryProvider');
  return ctx;
};

export const TelemetryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<'live' | 'mock'>('mock');
  const [runId, setRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<EngineRun[]>([]);
  const [tick, setTick] = useState(0);
  const [p1Handedness, setP1Handedness] = useState<'right' | 'left'>(() => {
    return (localStorage.getItem('p1_handedness') as 'right' | 'left') || 'right';
  });
  const [p2Handedness, setP2Handedness] = useState<'right' | 'left'>(() => {
    return (localStorage.getItem('p2_handedness') as 'right' | 'left') || 'right';
  });

  const updateP1Handedness = (h: 'right' | 'left') => {
    setP1Handedness(h);
    localStorage.setItem('p1_handedness', h);
  };
  const updateP2Handedness = (h: 'right' | 'left') => {
    setP2Handedness(h);
    localStorage.setItem('p2_handedness', h);
  };

  const [mapped, setMapped] = useState(() => ({
    match: MATCH_INFO,
    players: [PLAYER_1, PLAYER_2],
    rallies: RALLIES_DATA,
  }));

  const reload = () => setTick((t) => t + 1);
  const selectRun = (id: string) => {
    if (id && id !== runId) {
      setRunId(id);
      setTick((t) => t + 1);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const runList = await listRuns();
        if (cancelled) return;
        setRuns(runList);
        // Ưu tiên run COMPLETED mới nhất (BE đã sort mới nhất lên đầu).
        const chosen =
          (runId && runList.find((r) => r.runId === runId && r.status === 'COMPLETED')) ||
          runList.find((r) => r.status === 'COMPLETED');
        if (!chosen) throw new Error('Không có run COMPLETED nào');
        const result = await fetchRunFile<EngineResult>(chosen.runId, 'result.json');
        if (cancelled) return;
        setMapped(mapTelemetry(result, chosen.runId));
        setRunId(chosen.runId);
        setSource('live');
      } catch (err) {
        console.error('Lỗi nạp telemetry từ engine:', err);
        if (!cancelled) {
          setSource('mock');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const playersSafe = useMemo(() => {
    // Component UI luôn truy cập players[0]/players[1] — đệm mock nếu engine thiếu.
    const list = [...mapped.players];
    while (list.length < 2) list.push(list.length === 0 ? { ...PLAYER_1 } : { ...PLAYER_2 });
    return list.slice(0, 2);
  }, [mapped]);

  const value = useMemo<TelemetryState>(
    () => ({
      loading,
      source,
      runId,
      runs,
      reload,
      selectRun,
      p1Handedness,
      p2Handedness,
      setP1Handedness: updateP1Handedness,
      setP2Handedness: updateP2Handedness,
      ...mapped,
      players: playersSafe,
    }),
    [loading, source, runId, runs, p1Handedness, p2Handedness, mapped, playersSafe]
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
};
