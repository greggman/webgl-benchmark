// The benchmark runner: for each benchmark, init -> warmup -> calibrate -> measure.
//
// We measure how FAST the WebGL implementation sustains API calls, not how long the
// GPU takes to finish. The reported rate is ops over wall-clock time while keeping
// the pipe full — the standard "frames in flight" pattern: at most IN_FLIGHT frames
// are queued ahead of the GPU (backpressure via fence sync objects), and we never
// drain mid-window. Keeping the pipe full means we measure sustained throughput, NOT
// per-frame start+stop latency — that distinction is the whole point. (It's also why
// we do NOT readPixels/finish() per frame to "sync", and why there are no GPU timer
// queries: both would measure drain latency, not throughput.)

import type {
  Benchmark,
  BenchContext,
  BenchResult,
  RunnerConfig,
} from './types.js';
import {now, median, coefficientOfVariation} from '../gl/timing.js';
import {checkError} from '../gl/context.js';

// How many frames may be in flight at once. 2-3 is what real engines use; it keeps
// the pipe full without letting the GPU queue grow unbounded.
const IN_FLIGHT = 3;
// Safety cap so a stalled clock can never loop forever within one window.
const MAX_WINDOW_FRAMES = 200_000;

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

// Insert a fence marking "the GPU has finished everything issued so far".
function fence(gl: WebGL2RenderingContext): WebGLSync | null {
  return gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
}

// Wait until a fence is signalled, yielding to rAF between polls so the page (and
// Firefox's refresh driver) stays alive. This is backpressure / settling only — it
// is never timed, so it does not affect the measured throughput. SYNC_FLUSH_
// COMMANDS_BIT flushes on the first poll so the fence is guaranteed to progress.
async function awaitFence(
  gl: WebGL2RenderingContext,
  sync: WebGLSync | null,
): Promise<void> {
  if (!sync) {
    await nextFrame();
    return;
  }
  for (;;) {
    const status = gl.clientWaitSync(sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0);
    if (status !== gl.TIMEOUT_EXPIRED) {
      gl.deleteSync(sync);
      return;
    }
    await nextFrame();
  }
}

// Drain the GPU between phases (warmup/calibrate/measure) so phases don't bleed
// into one another. Not part of any timed measurement.
async function drain(gl: WebGL2RenderingContext): Promise<void> {
  await awaitFence(gl, fence(gl));
}

// Time a single frame's CPU issue cost (issue the calls + flush the command
// buffer). No GPU wait: flush() only kicks the command buffer, it does not block.
function issueFrame(
  gl: WebGL2RenderingContext,
  bench: Benchmark,
  count: number,
): number {
  const t0 = now();
  bench.runFrame(count);
  gl.flush();
  return now() - t0;
}

// Grow `count` by doubling until issuing one frame costs ~calibrateTargetMs of CPU
// time. Sizing on issue time (not GPU time) is the whole point: it scales the work
// so the measurement is comfortably above the clock's resolution, and it is what
// makes the per-op API cost the thing we measure.
async function calibrate(
  gl: WebGL2RenderingContext,
  bench: Benchmark,
  config: RunnerConfig,
): Promise<number> {
  const {calibrateTargetMs: targetMs, minCount, maxCount} = config;
  let count = minCount;
  let ms = 0;
  for (let i = 0; i < 24; i++) {
    // Min of two frames at this count to shrug off a one-off stall.
    await nextFrame();
    const a = issueFrame(gl, bench, count);
    const b = issueFrame(gl, bench, count);
    ms = Math.min(a, b);
    if (ms >= targetMs || count >= maxCount) break;
    count = Math.min(count * 2, maxCount);
  }
  // Scale the final count toward the target so we don't sit at a power-of-two edge.
  if (ms > 0.05) {
    const scaled = Math.round((count * targetMs) / ms);
    count = Math.max(minCount, Math.min(maxCount, scaled));
  }
  return count;
}

interface WindowResult {
  opsPerSec: number; // ops / wall-clock over the window (pipe kept full)
  frames: number;
  cpuPerFrame: number[]; // per-frame CPU issue times (for display only)
}

// Measure one window: issue frames as fast as we can for ~windowMs of wall time,
// keeping at most IN_FLIGHT frames in flight (backpressure) so the pipe stays full
// without unbounded queue growth. The rate is ops over wall-clock time. Because the
// pipe is kept full (we never drain mid-window), this is sustained throughput, not
// per-frame start+stop latency — the single end-of-window drain is amortized over
// many frames. Wall-clock also sidesteps the clock's per-frame resolution: one
// cheap frame can read 0, but a whole window is always tens of ms.
async function measureWindow(
  gl: WebGL2RenderingContext,
  bench: Benchmark,
  count: number,
  windowMs: number,
  shouldCancel?: () => boolean,
): Promise<WindowResult> {
  const cpuPerFrame: number[] = [];
  const inFlight: Array<WebGLSync | null> = [];
  let frames = 0;
  const start = now();
  do {
    if (shouldCancel?.()) throw new CancelledError();
    if (inFlight.length >= IN_FLIGHT) {
      // Real backpressure: don't get more than IN_FLIGHT ahead of the GPU.
      await awaitFence(gl, inFlight.shift()!);
    }
    cpuPerFrame.push(issueFrame(gl, bench, count));
    inFlight.push(fence(gl));
    frames++;
  } while (now() - start < windowMs && frames < MAX_WINDOW_FRAMES);
  // Drain the queued frames so the window's full cost is accounted for.
  for (const f of inFlight) await awaitFence(gl, f);
  const wallMs = now() - start;
  const opsPerSec = wallMs > 0 ? (count * frames * 1000) / wallMs : 0;
  return {opsPerSec, frames, cpuPerFrame};
}

export async function runBenchmark(
  bench: Benchmark,
  ctx: BenchContext,
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
    frames: 0,
    opsPerSec: 0,
    cpuMsPerFrame: 0,
    noise: 0,
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

  try {
    emit('init', 0);
    await bench.init(ctx);
    checkError(gl, `${bench.id}.init`);

    // Warmup: lets the implementation compile/link/allocate lazily; discarded.
    emit('warmup', 0);
    for (let f = 0; f < config.warmupFrames; f++) {
      if (hooks.shouldCancel?.()) throw new CancelledError();
      await nextFrame();
      issueFrame(gl, bench, config.minCount);
    }
    await drain(gl);

    emit('calibrate', 0);
    const count = await calibrate(gl, bench, config);
    await drain(gl);

    // Measure several short windows and take the median rate. A transient stall (GC,
    // scheduler, bandwidth contention) mostly slows a single window, so the median
    // across windows is far more reproducible. The first window is dropped as settle.
    emit('measure', 0);
    const windowRates: number[] = [];
    const cpuSamples: number[] = [];
    let frames = 0;
    for (let w = 0; w < config.measureWindows; w++) {
      if (hooks.shouldCancel?.()) throw new CancelledError();
      await nextFrame();
      const win = await measureWindow(
        gl,
        bench,
        count,
        config.measureWindowMs,
        hooks.shouldCancel,
      );
      emit('measure', (w + 1) / config.measureWindows);
      if (w === 0) continue; // drop first window
      windowRates.push(win.opsPerSec);
      cpuSamples.push(...win.cpuPerFrame);
      frames += win.frames;
    }

    checkError(gl, `${bench.id}.measure`);

    emit('done', 1);
    return {
      ...base,
      count,
      frames,
      opsPerSec: median(windowRates),
      cpuMsPerFrame: median(cpuSamples),
      noise: coefficientOfVariation(windowRates),
    };
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    emit('error', 1, String(err));
    return {...base, status: 'error', reason: String(err)};
  } finally {
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
