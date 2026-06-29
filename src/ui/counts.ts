import defaults from '../bench/defaultCounts.json';

// How much work each benchmark does ("count" = ops/frame) is FIXED, not re-calibrated
// per run. Re-calibrating was the biggest source of run-to-run noise, and — since the
// count lived in per-browser localStorage — two different browser builds (the whole
// point of an A/B comparison) never shared it. So the counts live in the PAGE, which
// both builds load identically. Source, in priority order:
//
//   1. a `?counts=<base64-json>` URL parameter — lock a custom/just-calibrated set and
//      open the SAME URL in both builds you're comparing (no rebuild needed);
//   2. the bundled defaultCounts.json (regenerate for your machine: `npm run counts`).
//
// A benchmark missing from both falls back to per-run calibration for that session.

const DEFAULTS = defaults as Record<string, number>;

export function loadCounts(): Map<string, number> {
  const counts = new Map<string, number>(
    Object.entries(DEFAULTS).map(([k, v]) => [k, Number(v)]),
  );
  const fromUrl = parseUrlCounts();
  if (fromUrl) for (const [id, n] of fromUrl) counts.set(id, n);
  return counts;
}

function parseUrlCounts(): Map<string, number> | null {
  try {
    const p = new URLSearchParams(location.search).get('counts');
    if (!p) return null;
    const obj = JSON.parse(atob(p)) as Record<string, unknown>;
    return new Map(Object.entries(obj).map(([k, v]) => [k, Number(v)]));
  } catch {
    return null;
  }
}

// A shareable URL that pins `counts` via ?counts=. Open it in both builds you're
// comparing so they measure identical work.
export function countsUrl(counts: Map<string, number>): string {
  const enc = btoa(JSON.stringify(Object.fromEntries(counts)));
  const u = new URL(location.href);
  u.searchParams.set('counts', enc);
  return u.toString();
}
