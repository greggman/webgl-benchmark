import type {Benchmark, BenchContext} from '../types.js';
import {makeTinyTriangle, type TinyTriangle} from './common.js';

// WEBGL_multi_draw: issue many sub-draws in a single multiDrawArraysWEBGL call.
// Contrast with `draw` to see how much the multi-draw path saves over N draws.
export function makeMultiDrawBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let ext: {
    multiDrawArraysWEBGL(
      mode: number,
      firsts: Int32Array,
      fOff: number,
      counts: Int32Array,
      cOff: number,
      drawCount: number,
    ): void;
  } | null = null;
  let tri: TinyTriangle;
  let firsts = new Int32Array(0);
  let counts = new Int32Array(0);
  return {
    id: 'multiDraw',
    name: 'multiDrawArrays',
    description: 'Many sub-draws batched into one multiDrawArraysWEBGL call.',
    supported(ctx: BenchContext) {
      return ctx.has('WEBGL_multi_draw');
    },
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      ext = ctx.env.ext('WEBGL_multi_draw') as typeof ext;
      tri = makeTinyTriangle(gl);
    },
    runFrame(count: number) {
      if (firsts.length < count) {
        firsts = new Int32Array(count); // all zero (first vertex 0)
        counts = new Int32Array(count).fill(3); // 3 verts each
      }
      gl.useProgram(tri.program);
      gl.bindVertexArray(tri.vao);
      gl.uniform4f(tri.u_color, 1, 0.7, 0.3, 1);
      gl.uniform2f(tri.u_offset, 0, 0);
      ext!.multiDrawArraysWEBGL(gl.TRIANGLES, firsts, 0, counts, 0, count);
    },
    dispose() {
      tri?.dispose();
    },
  };
}
