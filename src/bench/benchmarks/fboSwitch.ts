import type {Benchmark, BenchContext} from '../types.js';
import {
  makeTinyTriangle,
  makeFBOPool,
  type TinyTriangle,
  type FBOPool,
} from './common.js';

const POOL = 32;
const FBO_SIZE = 4;

// bindFramebuffer() + tiny clear/draw per "pass" — the closest WebGL analog to
// issuing many render passes. Scales the bind+clear+draw count.
export function makeFboSwitchBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle;
  let pool: FBOPool;
  let cw = 1;
  let ch = 1;
  return {
    id: 'fboSwitch',
    name: 'framebuffer switch',
    description:
      'Many bindFramebuffer() + clear/draw pairs across an FBO pool.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl);
      pool = makeFBOPool(gl, POOL, FBO_SIZE);
      cw = ctx.canvas.width;
      ch = ctx.canvas.height;
    },
    runFrame(count: number) {
      gl.useProgram(tri.program);
      gl.bindVertexArray(tri.vao);
      gl.uniform4f(tri.u_color, 0.5, 0.7, 1, 1);
      gl.uniform2f(tri.u_offset, 0, 0);
      for (let i = 0; i < count; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, pool.fbos[i % POOL]);
        gl.viewport(0, 0, FBO_SIZE, FBO_SIZE);
        gl.clearColor((i & 7) / 8, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
    },
    dispose() {
      pool?.dispose();
      tri?.dispose();
    },
  };
}
