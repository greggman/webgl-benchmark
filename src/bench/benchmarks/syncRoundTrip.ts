import type {Benchmark, BenchContext} from '../types.js';

// Isolate the cost of forcing the command buffer to flush and wait. getParameter
// of certain state forces a renderer<->GPU-process round-trip. This is a latency
// benchmark by design; like readPixelsSync it must never appear in hot loops of
// the throughput benches.
export function makeSyncRoundTripBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  return {
    id: 'syncRoundTrip',
    name: 'sync round-trips',
    description:
      'getError()/getParameter() round-trips; measures flush+wait cost.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
    },
    runFrame(count: number) {
      // Alternate between getError (cheap-ish flush) and a queried parameter
      // (forces a GPU-process round-trip) to sample both kinds of stall.
      for (let i = 0; i < count; i++) {
        if (i & 1) {
          gl.getError();
        } else {
          // CURRENT_PROGRAM is server state; querying it round-trips.
          gl.getParameter(gl.CURRENT_PROGRAM);
        }
      }
    },
    dispose() {
      /* nothing to free */
    },
  };
}
