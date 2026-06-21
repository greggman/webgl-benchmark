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

// One measurement window's worth of data.
export interface Window {
  frames: number;
  count: number;
  cpuMsTotal: number; // summed CPU time across the window's frames
  opsPerSec: number;
}

export type BenchStatus = 'ok' | 'skipped' | 'error';

export interface BenchResult {
  id: string;
  name: string;
  status: BenchStatus;
  reason?: string; // why skipped / error message
  count: number; // ops per frame chosen by calibration
  opsPerSec: number; // median window throughput
  cpuMsPerFrame: number; // median per-frame CPU time
  gpuMsPerFrame: number | null; // from timer query, if available
  noise: number; // coefficient of variation across kept windows
  gpuBoundSuspect: boolean; // gpu time ~= cpu frame time
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
  calibrateTargetMs: number; // aim per-frame CPU *issue* time during calibration
  gpuBudgetMs: number; // cap per-frame real (GPU-synced) time; bounds the count
  calibrateSamples: number; // frames median'd per calibration step
  calibrateMaxCount: number; // hard ceiling on the per-frame op count
  windows: number; // measurement windows (first is dropped)
  framesPerWindow: number;
}

export const DEFAULT_CONFIG: RunnerConfig = {
  warmupFrames: 10,
  calibrateTargetMs: 8,
  gpuBudgetMs: 20,
  calibrateSamples: 3,
  calibrateMaxCount: 1 << 18, // 256k — ultimate safety net
  windows: 5,
  framesPerWindow: 20,
};

// Fast profile for CI/Puppeteer: small counts and few frames so the whole suite
// finishes quickly even under software rendering (SwiftShader).
export const FAST_CONFIG: RunnerConfig = {
  warmupFrames: 2,
  calibrateTargetMs: 2,
  gpuBudgetMs: 15,
  calibrateSamples: 2,
  calibrateMaxCount: 1 << 14,
  windows: 2,
  framesPerWindow: 8,
};
