import type {
  Benchmark,
  BenchContext,
  BenchResult,
  RunnerConfig,
} from './types.js';
import {
  now,
  median,
  coefficientOfVariation,
  createGpuTimer,
} from '../gl/timing.js';
import {checkError} from '../gl/context.js';
import type {GLEnv} from '../gl/context.js';

export interface ProgressEvent {
  benchId: string;
  benchName: string;
  index: number;
  total: number;
  phase:
    | 'init'
    | 'warmup'
    | 'calibrate'
    | 'measure'
    | 'done'
    | 'skipped'
    | 'error';
  fraction: number; // 0..1 within the whole run
  message?: string;
}

export interface RunnerHooks {
  onProgress?(ev: ProgressEvent): void;
  shouldCancel?(): boolean;
}

// Await the next animation frame, so the browser composites and stays responsive.
function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

// Force the GPU to actually finish the work issued so far, then return.
//
// WebGL's finish() is NOT enough: in Chrome it's a "shallow" finish that flushes
// the command buffer and waits only for the GPU process to ingest the commands —
// it does not wait for the GPU to execute them. Reading a single pixel does: a
// readPixels can't return until the framebuffer has actually been rendered, so it
// blocks on a real GPU round-trip. We bind the default framebuffer first so the
// read is always from a readable RGBA8 surface regardless of what the bench left
// bound.
const SYNC_PX = new Uint8Array(4);
function gpuSync(gl: WebGL2RenderingContext): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, SYNC_PX);
}

// Time a single frame: issue the calls, flush, measure CPU wall time around it.
// During the measurement loop we deliberately do NOT sync — draining the pipe
// every frame would measure start+stop latency instead of sustained throughput.
// During calibration we DO sync (block=true): see calibrate() for why.
function timeFrame(
  gl: WebGL2RenderingContext,
  bench: Benchmark,
  count: number,
  block = false,
): number {
  const t0 = now();
  bench.runFrame(count);
  gl.flush();
  if (block) gpuSync(gl);
  return now() - t0;
}

// Pick a per-frame op count, in two phases.
//
// Phase 1 — size by CPU *issue* time (flush only, no GPU sync). The measurement
// loop also never syncs per frame, so this is the number that puts the measured
// per-frame CPU time well above the timer's resolution and makes the throughput
// metric meaningful (rather than quantization noise).
//
// Phase 2 — bound by a GPU budget. Some benches are cheap to *issue* but do real
// GPU work per op (e.g. framebuffer switch + clear + draw). At the issue-sized
// count from phase 1, one frame's actual GPU work can be enormous, and because the
// measurement loop never syncs per frame, that work piles up and the page freezes.
// We measure the real, GPU-synced frame time once (gpuSync — a readPixels
// round-trip; WebGL finish() would NOT wait for the GPU) and, if it blows the
// budget, scale the count down to fit. For purely CPU-bound benches the GPU work
// is tiny, so the budget never bites and the phase-1 count stands.
async function calibrate(
  gl: WebGL2RenderingContext,
  bench: Benchmark,
  config: RunnerConfig,
): Promise<number> {
  const {
    calibrateTargetMs: targetMs,
    gpuBudgetMs,
    calibrateMaxCount: maxCount,
    calibrateSamples,
  } = config;

  // Phase 1: grow the count until issuing a frame costs ~targetMs of CPU time.
  let count = 64;
  for (let i = 0; i < 24; i++) {
    // Median of a few frames at this count to dodge one-off stalls.
    const samples: number[] = [];
    for (let f = 0; f < calibrateSamples; f++) {
      await nextFrame();
      samples.push(timeFrame(gl, bench, count));
    }
    const ms = median(samples);
    if (ms >= targetMs || count >= maxCount) break;
    // Scale toward the target but cap the jump so we don't overshoot wildly.
    const factor = ms > 0.05 ? Math.min(8, Math.max(2, targetMs / ms)) : 8;
    count = Math.min(maxCount, Math.ceil(count * factor));
  }

  // Phase 2: if the real (GPU-synced) frame time at this count blows the budget,
  // shrink the count to fit so the measurement loop can't flood the GPU.
  const synced: number[] = [];
  for (let f = 0; f < calibrateSamples; f++) {
    await nextFrame();
    synced.push(timeFrame(gl, bench, count, true));
  }
  const syncedMs = median(synced);
  if (syncedMs > gpuBudgetMs) {
    count = Math.max(64, Math.floor((count * gpuBudgetMs) / syncedMs));
  }
  return count;
}

export async function runBenchmark(
  bench: Benchmark,
  ctx: BenchContext,
  env: GLEnv,
  config: RunnerConfig,
  index: number,
  total: number,
  hooks: RunnerHooks,
): Promise<BenchResult> {
  const {gl} = ctx;
  const emit = (
    phase: ProgressEvent['phase'],
    fracWithin: number,
    message?: string,
  ) => {
    hooks.onProgress?.({
      benchId: bench.id,
      benchName: bench.name,
      index,
      total,
      phase,
      fraction: (index + Math.max(0, Math.min(1, fracWithin))) / total,
      message,
    });
  };

  const base: BenchResult = {
    id: bench.id,
    name: bench.name,
    status: 'ok',
    count: 0,
    opsPerSec: 0,
    cpuMsPerFrame: 0,
    gpuMsPerFrame: null,
    noise: 0,
    gpuBoundSuspect: false,
    score: 0,
  };

  if (bench.supported && !bench.supported(ctx)) {
    emit('skipped', 1, 'unsupported');
    return {
      ...base,
      status: 'skipped',
      reason: 'feature/extension not available',
    };
  }

  // Optional GPU timing to sanity-check that we're not GPU-bound.
  const timerExt = env.ext('EXT_disjoint_timer_query_webgl2');
  const gpuTimer = createGpuTimer(gl, timerExt);

  try {
    emit('init', 0);
    await bench.init(ctx);
    checkError(gl, `${bench.id}.init`);

    // Warmup: lets the implementation compile/link/allocate lazily; discarded.
    emit('warmup', 0);
    for (let f = 0; f < config.warmupFrames; f++) {
      if (hooks.shouldCancel?.()) throw new CancelledError();
      await nextFrame();
      timeFrame(gl, bench, 256);
    }
    gpuSync(gl);

    emit('calibrate', 0);
    const count = await calibrate(gl, bench, config);

    // Measure: several windows; drop the first as extra settle time, then take
    // the median window's throughput. CPU issue time is the implementation cost.
    //
    // Each window issues framesPerWindow frames back-to-back (no rAF wait between
    // them) and times the whole batch with a SINGLE clock read. We can't time
    // individual frames: a cheap bench (e.g. one multiDraw call) costs less per
    // frame than performance.now()'s resolution — Chrome coarsens it to ~100µs —
    // so per-frame deltas read 0 and the throughput would divide by zero. Timing
    // the batch makes the measured span comfortably larger than the clock's
    // granularity. The GPU is drained once at the window boundary (not per frame),
    // so per-window GPU work is bounded (calibration capped per-frame GPU work to
    // gpuBudgetMs) without measuring start+stop latency per frame.
    const windowOps: number[] = [];
    const windowCpuPerFrame: number[] = [];
    const gpuSamples: number[] = [];
    for (let w = 0; w < config.windows; w++) {
      if (hooks.shouldCancel?.()) throw new CancelledError();
      await nextFrame(); // align to a fresh frame and let the page breathe
      const t0 = now();
      for (let f = 0; f < config.framesPerWindow; f++) {
        gpuTimer?.begin();
        bench.runFrame(count);
        gl.flush();
        gpuTimer?.end();
        const g = gpuTimer?.poll();
        if (typeof g === 'number') gpuSamples.push(g);
      }
      const cpuTotal = now() - t0;
      // Real GPU drain at the window boundary; finish() wouldn't actually wait.
      gpuSync(gl);
      emit('measure', (w + 1) / config.windows);
      if (w === 0) continue; // drop first window
      // Floor the denominator as a last-resort guard against an unmeasurable span.
      const seconds = Math.max(cpuTotal, 1e-3) / 1000;
      windowOps.push((count * config.framesPerWindow) / seconds);
      windowCpuPerFrame.push(cpuTotal / config.framesPerWindow);
    }

    checkError(gl, `${bench.id}.measure`);

    const opsPerSec = median(windowOps);
    const cpuMsPerFrame = median(windowCpuPerFrame);
    const gpuMsPerFrame = gpuSamples.length ? median(gpuSamples) : null;
    const noise = coefficientOfVariation(windowOps);
    // If the GPU is busy nearly as long as the CPU frame, the number is suspect.
    const gpuBoundSuspect =
      gpuMsPerFrame !== null && gpuMsPerFrame >= cpuMsPerFrame * 0.8;

    emit('done', 1);
    return {
      ...base,
      count,
      opsPerSec,
      cpuMsPerFrame,
      gpuMsPerFrame,
      noise,
      gpuBoundSuspect,
    };
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    emit('error', 1, String(err));
    return {...base, status: 'error', reason: String(err)};
  } finally {
    gpuTimer?.dispose();
    try {
      bench.dispose();
    } catch {
      /* ignore teardown errors */
    }
  }
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}
