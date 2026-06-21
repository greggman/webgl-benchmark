import type {Benchmark, BenchContext} from '../types.js';
import {
  makeTinyTriangle,
  makeIndexBuffer,
  type TinyTriangle,
} from './common.js';

// Many drawElements() calls against a 3-index buffer.
export function makeDrawElementsBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle;
  let ibo: WebGLBuffer;
  return {
    id: 'drawElements',
    name: 'drawElements',
    description: 'Many drawElements() calls against a tiny index buffer.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl);
      gl.bindVertexArray(tri.vao);
      ibo = makeIndexBuffer(gl); // bound into the VAO's element slot
      gl.bindVertexArray(null);
    },
    runFrame(count: number) {
      gl.useProgram(tri.program);
      gl.bindVertexArray(tri.vao);
      gl.uniform4f(tri.u_color, 0.9, 0.5, 0.2, 1);
      for (let i = 0; i < count; i++) {
        gl.uniform2f(tri.u_offset, 0, ((i & 63) - 32) / 64);
        gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);
      }
    },
    dispose() {
      gl?.deleteBuffer(ibo);
      tri?.dispose();
    },
  };
}
