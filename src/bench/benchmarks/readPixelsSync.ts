import type {Benchmark, BenchContext} from '../types.js';
import {
  makeTinyTriangle,
  makeFBOPool,
  type TinyTriangle,
  type FBOPool,
} from './common.js';

// Synchronous readPixels() of a 1x1 region. Each call forces a flush + GPU-process
// round-trip and stalls the pipeline. This measures round-trip *latency*, not
// throughput — which is exactly why it lives in its own benchmark and never leaks
// into the throughput benches.
export function makeReadPixelsSyncBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle;
  let pool: FBOPool;
  const px = new Uint8Array(4);
  return {
    id: 'readPixelsSync',
    name: 'readPixels (sync)',
    description:
      'Synchronous 1x1 readPixels() round-trips; measures stall latency.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl);
      pool = makeFBOPool(gl, 1, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pool.fbos[0]);
      gl.viewport(0, 0, 4, 4);
    },
    runFrame(count: number) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, pool.fbos[0]);
      gl.useProgram(tri.program);
      gl.bindVertexArray(tri.vao);
      gl.uniform4f(tri.u_color, 1, 0.3, 0.3, 1);
      gl.uniform2f(tri.u_offset, 0, 0);
      for (let i = 0; i < count; i++) {
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
    },
    dispose() {
      gl?.bindFramebuffer(gl.FRAMEBUFFER, null);
      pool?.dispose();
      tri?.dispose();
    },
  };
}
