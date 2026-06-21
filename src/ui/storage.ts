import type {RunData} from '../bench/types.js';

const KEY = 'webgl-benchmark:runs';

// Persisted runs are keyed by timestamp+label inside a single localStorage entry.
export function loadRuns(): RunData[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RunData[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveAll(runs: RunData[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(runs));
  } catch (err) {
    console.warn('Could not persist runs to localStorage:', err);
  }
}

export function runKey(run: RunData): string {
  return `${run.timestamp}:${run.label}`;
}

export function saveRun(run: RunData): RunData[] {
  const runs = loadRuns();
  // De-dupe by key so re-importing the same file doesn't pile up.
  const existing = runs.findIndex(r => runKey(r) === runKey(run));
  if (existing >= 0) runs[existing] = run;
  else runs.push(run);
  runs.sort((a, b) => b.timestamp - a.timestamp);
  saveAll(runs);
  return runs;
}

export function deleteRun(key: string): RunData[] {
  const runs = loadRuns().filter(r => runKey(r) !== key);
  saveAll(runs);
  return runs;
}

export function relabelRun(key: string, label: string): RunData[] {
  const runs = loadRuns();
  const r = runs.find(x => runKey(x) === key);
  if (r) r.label = label;
  saveAll(runs);
  return runs;
}

// Download a run as a JSON file the user can re-import / share.
export function downloadRun(run: RunData): void {
  const blob = new Blob([JSON.stringify(run, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (run.label || 'run').replace(/[^a-z0-9-_]+/gi, '_');
  a.href = url;
  a.download = `webgl-benchmark-${safe}-${run.timestamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Validate enough of a parsed object to treat it as a RunData.
export function isRunData(x: unknown): x is RunData {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.timestamp === 'number' &&
    typeof r.label === 'string' &&
    Array.isArray(r.results)
  );
}
