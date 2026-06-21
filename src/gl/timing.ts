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

// Optional GPU timing via EXT_disjoint_timer_query_webgl2. Many configs (e.g.
// macOS/Metal-ANGLE) don't expose it; callers must degrade gracefully.
export interface GpuTimer {
  begin(): void;
  end(): void;
  // Returns elapsed ms for completed queries, or null if none are ready yet.
  poll(): number | null;
  dispose(): void;
}

export function createGpuTimer(
  gl: WebGL2RenderingContext,
  ext: unknown | null,
): GpuTimer | null {
  if (!ext) return null;
  const TIME_ELAPSED = 0x88bf; // EXT_disjoint_timer_query
  const GPU_DISJOINT = 0x8fbb;
  const inflight: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;

  return {
    begin() {
      if (active) return;
      const q = gl.createQuery();
      if (!q) return;
      gl.beginQuery(TIME_ELAPSED, q);
      active = q;
    },
    end() {
      if (!active) return;
      gl.endQuery(TIME_ELAPSED);
      inflight.push(active);
      active = null;
    },
    poll() {
      const disjoint = gl.getParameter(GPU_DISJOINT);
      if (disjoint) {
        // Timings are unreliable this interval; drop everything pending.
        for (const q of inflight) gl.deleteQuery(q);
        inflight.length = 0;
        return null;
      }
      if (inflight.length === 0) return null;
      const q = inflight[0];
      const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
      if (!available) return null;
      inflight.shift();
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      return ns / 1e6; // ns -> ms
    },
    dispose() {
      if (active) {
        gl.endQuery(TIME_ELAPSED);
        gl.deleteQuery(active);
        active = null;
      }
      for (const q of inflight) gl.deleteQuery(q);
      inflight.length = 0;
    },
  };
}
