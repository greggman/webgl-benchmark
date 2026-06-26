// Timing + small statistics helpers used by the runner.

export function now(): number {
  return performance.now();
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Coefficient of variation (stddev / mean) — our "Noise" figure.
export function coefficientOfVariation(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  if (m === 0) return 0;
  const variance =
    xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(variance) / m;
}

// Geometric mean — used for the overall score so no single bench dominates.
export function geomean(xs: number[]): number {
  const positive = xs.filter(x => x > 0 && Number.isFinite(x));
  if (positive.length === 0) return 0;
  const sumLog = positive.reduce((a, x) => a + Math.log(x), 0);
  return Math.exp(sumLog / positive.length);
}
