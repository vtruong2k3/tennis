export interface EngineRun {
  runId: string;
  status: string;
  files: string[];
  /** Server còn file video gốc cho run này không. */
  hasVideo?: boolean;
  /** Video có khớp marker .videoPath của run (run cũ copy JSON về có thể sai nguồn). */
  videoVerified?: boolean;
}

// Cùng origin — Vite proxy '/internal' về tennis-engine (mặc định localhost:4200).
export async function listRuns(): Promise<EngineRun[]> {
  const res = await fetch('/internal/v1/test/runs');
  if (!res.ok) throw new Error(`listRuns: HTTP ${res.status}`);
  const data = await res.json();
  return (data.runs ?? []) as EngineRun[];
}

export async function fetchRunFile<T = unknown>(runId: string, name: string): Promise<T> {
  const res = await fetch(`/internal/v1/test/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`fetchRunFile(${name}): HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ----- Chạy phân tích mới: upload → start → SSE events → cancel -----

export function uploadVideo(file: File, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/internal/v1/test/upload?filename=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && data.videoPath) resolve(data.videoPath as string);
        else reject(new Error(data.message || `Upload thất bại (HTTP ${xhr.status})`));
      } catch {
        reject(new Error('Phản hồi upload không hợp lệ'));
      }
    };
    xhr.onerror = () => reject(new Error('Lỗi mạng khi upload video'));
    xhr.send(file);
  });
}

export async function startRun(videoPath: string): Promise<string> {
  const res = await fetch('/internal/v1/test/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoPath, keepDebugArtifacts: false }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.runId) throw new Error(data.message || `Không khởi tạo được phân tích (HTTP ${res.status})`);
  return data.runId as string;
}

export async function cancelRun(runId: string): Promise<void> {
  await fetch(`/internal/v1/test/cancel/${encodeURIComponent(runId)}`, { method: 'POST' });
}

// ----- Dữ liệu AR cho overlay video -----

export interface ArTrailPoint {
  t: number;
  u: number;
  v: number;
}

export interface ArCourtKeyframe {
  tMs: number;
  lines: Record<string, number[][][]>;
}

export interface ArCourtSegment {
  startMs: number;
  endMs: number;
  lines: Record<string, number[][][]>;
  keyframes?: ArCourtKeyframe[];
  /** Khoảng [ms, ms] overlay sân đáng tin — camera cắt cận cảnh thì worker
   *  chấm điểm từng frame và loại khoảng đó; ngoài các khoảng này phải ẩn overlay. */
  validWindows?: [number, number][];
}

export interface ArPlayerSample {
  t: number;
  p: ([number, number] | null)[]; // vị trí trung tâm [u, v] chuẩn hoá, theo index VĐV
  feet: ([number, number] | null)[]; // vị trí bàn chân [u, v]
}

export interface ArData {
  runId: string;
  result: {
    players?: unknown[];
    rallies?: { startMs: number; endMs: number; [k: string]: unknown }[];
  };
  court: { segments?: ArCourtSegment[] };
  ball: { trail?: ArTrailPoint[]; shots?: ArTrailPoint[]; bounces?: ArTrailPoint[] };
  players: { samples?: ArPlayerSample[]; playerCount?: number };
}

export async function fetchArData(runId: string): Promise<ArData> {
  const res = await fetch(`/internal/v1/test/runs/${encodeURIComponent(runId)}/ar-data`);
  if (!res.ok) throw new Error(`Không tải được dữ liệu AR (HTTP ${res.status})`);
  return (await res.json()) as ArData;
}
