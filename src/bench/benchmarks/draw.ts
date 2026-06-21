import type {Benchmark, BenchContext} from '../types.js';
import {makeTinyTriangle, colorFor, type TinyTriangle} from './common.js';

// Many drawArrays() calls of a sub-pixel triangle. Pure draw-call overhead.
export function makeDrawBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle;
  return {
    id: 'draw',
    name: 'drawArrays',
    description: 'Many drawArrays() calls of a sub-pixel triangle.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl);
    },
    runFrame(count: number) {
      gl.useProgram(tri.program);
      gl.bindVertexArray(tri.vao);
      gl.uniform4f(tri.u_color, 0.2, 0.6, 1, 1);
      for (let i = 0; i < count; i++) {
        // Tiny per-call variation keeps the output visibly moving.
        gl.uniform2f(tri.u_offset, ((i & 63) - 32) / 64, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // Recolor occasionally so the canvas animates.
      gl.uniform4fv(tri.u_color, colorFor(count));
    },
    dispose() {
      tri?.dispose();
    },
  };
}
