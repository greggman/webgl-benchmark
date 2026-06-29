import type {GLEnv} from '../gl/context.js';

// Everything a benchmark needs to create resources and draw.
export interface BenchContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  env: GLEnv;
  has(ext: string): boolean;
}

export interface Benchmark {
  id: string; // stable key for storage/compare
  name: string; // human label
  description: string;
  // Optional gate: return false to auto-skip when a feature/extension is missing.
  supported?(ctx: BenchContext): boolean;
  // Create GL resources once. May be async (e.g. image decode).
  init(ctx: BenchContext): Promise<void>;
  // Do exactly `count` units of work for one frame (count = the thing we scale).
  runFrame(count: number): void;
  // Cleanup buffers/textures/programs/VAOs/FBOs.
  dispose(): void;
}

export type BenchStatus = 'ok' | 'skipped' | 'error';

export interface BenchResult {
  id: string;
  name: string;
  status: BenchStatus;
  reason?: string; // why skipped / error message
  count: number; // ops per frame chosen by calibration
  frames: number; // total frames measured
  opsPerSec: number; // median window throughput (ops / CPU issue time)
  cpuMsPerFrame: number; // median per-frame CPU issue time (informational)
  noise: number; // coefficient of variation across kept windows
  durationMs: number; // total wall-clock time spent on this benchmark (all phases)
  score: number; // normalized vs baseline (filled in by scoring)
}

export interface RunInfo {
  vendor: string;
  renderer: string;
  version: string;
  glslVersion: string;
  userAgent: string;
}

export interface RunData {
  label: string;
  timestamp: number;
  iso: string;
  info: RunInfo;
  results: BenchResult[];
  overall: number;
}

// Knobs for the runner; the test harness uses a fast profile.
export interface RunnerConfig {
  warmupFrames: number;
  calibrateTargetMs: number; // grow count until one frame costs this much CPU to issue
  minCount: number; // smallest per-frame op count
  maxCount: number; // largest per-frame op count
  measureWindows: number; // measurement windows (first is dropped as settle)
  measureWindowMs: number; // wall-clock duration of each window (incl. GPU completion)
}

export const DEFAULT_CONFIG: RunnerConfig = {
  warmupFrames: 10,
  calibrateTargetMs: 5,
  minCount: 16,
  maxCount: 1 << 18, // 256k
  measureWindows: 5, // median of 4 after dropping the first
  measureWindowMs: 300, // longer window → vsync quantization is a smaller fraction
};

// Fast profile for CI/Puppeteer.
export const FAST_CONFIG: RunnerConfig = {
  warmupFrames: 3,
  calibrateTargetMs: 2,
  minCount: 8,
  maxCount: 1 << 13,
  measureWindows: 3,
  measureWindowMs: 80,
};
