import type {BenchResult} from '../bench/types.js';
import {geomean} from '../gl/timing.js';
import baseline from './baseline.json';

// baseline maps benchmark id -> reference operations/second. A score of ~1000
// means "matches the reference machine"; higher is better. Regenerate with
// `npm run baseline` on your own hardware to recenter scoring.
const BASELINE = baseline as Record<string, number>;

export function scoreFor(id: string, opsPerSec: number): number {
  const ref = BASELINE[id];
  if (!ref || ref <= 0 || !Number.isFinite(opsPerSec)) return 0;
  return (opsPerSec / ref) * 1000;
}

// Fill in per-benchmark scores and return the overall geometric mean. Skipped and
// errored benches are excluded from the overall so machines with different
// extension support still compare on their intersection.
export function applyScores(results: BenchResult[]): number {
  const ok: number[] = [];
  for (const r of results) {
    if (r.status === 'ok') {
      r.score = scoreFor(r.id, r.opsPerSec);
      ok.push(r.score);
    } else {
      r.score = 0;
    }
  }
  return geomean(ok);
}

export function hasBaseline(id: string): boolean {
  return Number.isFinite(BASELINE[id]) && BASELINE[id] > 0;
}
