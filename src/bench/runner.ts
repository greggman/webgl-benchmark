// The benchmark runner: for each benchmark, init -> warmup -> calibrate -> measure.
//
// We measure sustained throughput INCLUDING the GPU-process work, not just the
// renderer-side cost of issuing the call. The reported rate is ops ÷ wall-clock time
// with the GPU pipe kept full and the work actually drained (fences) within the
// window — so uploads, UBO updates, and allocation/deallocation in the GPU process
// all count. That's deliberate: a benchmark that times only the JS call (issue time)
// is blind to GPU-process performance, which is exactly the thing we want to surface
// (e.g. comparing two builds of Chrome's GPU process).
//
// Consequence: for benches whose per-frame work is far below a display refresh
// interval, the rAF-paced fence polling adds vsync-quantization noise. For the
// GPU-bound benches this is aimed at, the GPU completion dominates and the number
// tracks GPU-process throughput. (No GPU timer queries — unreliable across impls.)

import type {
  Benchmark,
  BenchContext,
  BenchResult,
  RunnerConfig,
} from './types.js';
import {now, median, coefficientOfVariation} from '../gl/timing.js';
import {checkError} from '../gl/context.js';

// How many frames may be in flight at once before we wait on the oldest fence.
// Keeping a few queued avoids a per-frame task yield (which would be rAF-paced and
// make the CPU bursty); the wait is excluded from the measurement either way.
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
// We yield via rAF (not a faster MessageChannel task): it works in every browser,
// Firefox only advances GL/fence state on a paint, and empirically a WebGL fence
// takes longer than one MessageChannel task to signal anyway, so the fast yield
// bought nothing.
function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

// Insert a fence marking "the GPU has finished everything issued so far".
function fence(gl: WebGL2RenderingContext): WebGLSync | null {
  return gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
}

// Wait until a fence is signalled, yielding to rAF between polls. Backpressure /
// settling only — never timed, so it can't affect the measured throughput.
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
  opsPerSec: number; // ops / wall-clock INCLUDING GPU completion
  frames: number;
  msPerFrame: number; // wall-clock per frame (issue + GPU completion)
}

// Measure one window of sustained GPU-completion throughput. We keep the GPU pipe
// full (up to IN_FLIGHT frames in flight via fences), run for `windowMs` of WALL
// time, and count the ops that completed — rate = ops ÷ wall time. Crucially the
// wall time INCLUDES the GPU finishing the work (the fence drains), because the cost
// we want to surface is the implementation's GPU-process work — uploads, UBO
// updates, allocation/deallocation — not just the renderer-side cost of issuing the
// call. (That GPU-process cost is exactly what a "time only the JS call" metric
// throws away, which is why issuing then waiting is the point here, not a mistake.)
//
// Tradeoff, by design: for benches whose per-frame work is far below a vsync
// interval, the rAF-paced fence polling caps the rate and adds some quantization
// noise. For the GPU-bound benches this is aimed at, each frame is many ms and the
// GPU completion dominates, so the number tracks GPU-process throughput.
async function measureWindow(
  gl: WebGL2RenderingContext,
  bench: Benchmark,
  count: number,
  windowMs: number,
  shouldCancel?: () => boolean,
): Promise<WindowResult> {
  const inFlight: Array<WebGLSync | null> = [];
  let frames = 0;
  const start = now();
  do {
    if (shouldCancel?.()) throw new CancelledError();
    if (inFlight.length >= IN_FLIGHT) {
      await awaitFence(gl, inFlight.shift()!);
    }
    bench.runFrame(count);
    gl.flush();
    inFlight.push(fence(gl));
    frames++;
  } while (now() - start < windowMs && frames < MAX_WINDOW_FRAMES);
  // Drain the queued frames so the window's full GPU cost is in the wall time.
  for (const f of inFlight) await awaitFence(gl, f);
  const wallMs = now() - start;
  const opsPerSec = wallMs > 0 ? (count * frames * 1000) / wallMs : 0;
  return {opsPerSec, frames, msPerFrame: frames > 0 ? wallMs / frames : 0};
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

  const tStart = now();
  const base: BenchResult = {
    id: bench.id,
    name: bench.name,
    status: 'ok',
    count: 0,
    frames: 0,
    opsPerSec: 0,
    cpuMsPerFrame: 0,
    noise: 0,
    durationMs: 0,
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
    // Phase fractions are monotonic within a bench so the progress bar never jumps
    // backwards: init 0 → warmup .05 → calibrate .15 → warmup .3 → measure .4…1.
    emit('init', 0);
    await bench.init(ctx);
    checkError(gl, `${bench.id}.init`);

    // Pre-warm: a few small frames so calibration doesn't time first-call shader
    // compile / lazy allocation.
    emit('warmup', 0.05);
    for (let f = 0; f < config.warmupFrames; f++) {
      if (hooks.shouldCancel?.()) throw new CancelledError();
      await nextFrame();
      issueFrame(gl, bench, config.minCount);
    }
    await drain(gl);

    emit('calibrate', 0.15);
    const count = await calibrate(gl, bench, config);
    await drain(gl);

    // Warm the ACTUAL measurement workload at the chosen count. The first sustained
    // run on a fresh page pays a cold-start cost (driver pipeline/shader caches, JIT
    // of the hot loop) that otherwise lands entirely on the first measured run and
    // shows up as a ~2x slower outlier. Running the real workload here, discarded,
    // makes the first user-visible run match later ones.
    emit('warmup', 0.3);
    for (let f = 0; f < config.warmupFrames; f++) {
      if (hooks.shouldCancel?.()) throw new CancelledError();
      await nextFrame();
      issueFrame(gl, bench, count);
    }
    await drain(gl);

    // Measure several short windows and take the median rate. A transient stall (GC,
    // scheduler, bandwidth contention) mostly slows a single window, so the median
    // across windows is far more reproducible. The first window is dropped as settle.
    emit('measure', 0.4);
    const windowRates: number[] = [];
    const cpuPerFrame: number[] = [];
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
      emit('measure', 0.4 + (0.6 * (w + 1)) / config.measureWindows);
      if (w === 0) continue; // drop first window
      windowRates.push(win.opsPerSec);
      cpuPerFrame.push(win.msPerFrame);
      frames += win.frames;
    }

    checkError(gl, `${bench.id}.measure`);

    emit('done', 1);
    return {
      ...base,
      count,
      frames,
      opsPerSec: median(windowRates),
      cpuMsPerFrame: median(cpuPerFrame),
      noise: coefficientOfVariation(windowRates),
      durationMs: now() - tStart,
    };
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    emit('error', 1, String(err));
    return {
      ...base,
      status: 'error',
      reason: String(err),
      durationMs: now() - tStart,
    };
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
