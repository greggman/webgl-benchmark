import type {Benchmark, BenchContext} from '../types.js';
import {makeTinyTriangle, type TinyTriangle} from './common.js';

// Many viewport()/scissor() calls between tiny draws.
export function makeViewportScissorBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle;
  let w = 1;
  let h = 1;
  return {
    id: 'viewportScissor',
    name: 'viewport/scissor churn',
    description: 'Many viewport()/scissor() calls between tiny draws.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl);
      w = ctx.canvas.width;
      h = ctx.canvas.height;
    },
    runFrame(count: number) {
      gl.useProgram(tri.program);
      gl.bindVertexArray(tri.vao);
      gl.uniform4f(tri.u_color, 0.95, 0.85, 0.2, 1);
      gl.uniform2f(tri.u_offset, 0, 0);
      gl.enable(gl.SCISSOR_TEST);
      for (let i = 0; i < count; i++) {
        const x = i % w;
        const y = (i * 7) % h;
        gl.viewport(x, y, 1, 1);
        gl.scissor(x, y, 1, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, w, h);
    },
    dispose() {
      tri?.dispose();
    },
  };
}
