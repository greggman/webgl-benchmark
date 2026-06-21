import type {Benchmark, BenchContext} from '../types.js';
import {makeTinyTriangle, type TinyTriangle} from './common.js';

// Toggle enable/disable + blendFunc/depthFunc between draws. Stresses the
// fixed-function state-tracking path the implementation has to validate.
export function makeStateChangeBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle;
  return {
    id: 'stateChange',
    name: 'state toggles',
    description: 'enable/disable + blendFunc/depthFunc churn between draws.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl);
    },
    runFrame(count: number) {
      gl.useProgram(tri.program);
      gl.bindVertexArray(tri.vao);
      gl.uniform4f(tri.u_color, 0.3, 0.9, 0.9, 1);
      gl.uniform2f(tri.u_offset, 0, 0);
      for (let i = 0; i < count; i++) {
        if (i & 1) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.disable(gl.CULL_FACE);
        } else {
          gl.disable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ZERO);
          gl.enable(gl.CULL_FACE);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
    },
    dispose() {
      tri?.dispose();
    },
  };
}
