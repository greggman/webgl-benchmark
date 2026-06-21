import type {Benchmark, BenchContext} from '../types.js';
import {makeTinyTriangle, type TinyTriangle} from './common.js';

// Many drawArraysInstanced() calls, each with a *tiny* instance count, so the
// per-call overhead dominates rather than the instancing itself.
export function makeDrawInstancedBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle;
  return {
    id: 'drawInstanced',
    name: 'drawArraysInstanced',
    description: 'Many instanced draws, each with a tiny instance count.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl);
    },
    runFrame(count: number) {
      gl.useProgram(tri.program);
      gl.bindVertexArray(tri.vao);
      gl.uniform4f(tri.u_color, 0.4, 1, 0.6, 1);
      for (let i = 0; i < count; i++) {
        gl.uniform2f(tri.u_offset, ((i & 63) - 32) / 64, 0);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 2);
      }
    },
    dispose() {
      tri?.dispose();
    },
  };
}
