import type {Benchmark, BenchContext} from '../types.js';
import {linkProgram, manyUniformVS, TINY_FS} from '../../gl/shaders.js';
import {makeTinyTriangle, type TinyTriangle} from './common.js';

const N_UNIFORMS = 16; // uniform calls per draw

// Set many uniform4fv() per draw — one of the biggest real-world WebGL costs.
// The unit scaled is the number of uniform updates, not the draws.
export function makeUniformUpdatesBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle; // reused for its VAO geometry
  let program: WebGLProgram;
  let locs: (WebGLUniformLocation | null)[] = [];
  const val = new Float32Array(4);
  return {
    id: 'uniformUpdates',
    name: 'uniform updates',
    description: `Setting ${N_UNIFORMS} uniform4fv() per draw; scales uniform-call count.`,
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl);
      program = linkProgram(gl, manyUniformVS(N_UNIFORMS), TINY_FS);
      locs = Array.from({length: N_UNIFORMS}, (_, i) =>
        gl.getUniformLocation(program, `u_v${i}`),
      );
    },
    runFrame(count: number) {
      gl.useProgram(program);
      gl.bindVertexArray(tri.vao);
      const u_color = gl.getUniformLocation(program, 'u_color');
      if (u_color) gl.uniform4f(u_color, 0.6, 0.8, 1, 1);
      // `count` uniform updates total, batched into draws of N_UNIFORMS each.
      let done = 0;
      while (done < count) {
        const n = Math.min(N_UNIFORMS, count - done);
        for (let i = 0; i < n; i++) {
          val[0] = i * 0.01;
          gl.uniform4fv(locs[i], val);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        done += n;
      }
    },
    dispose() {
      gl?.deleteProgram(program);
      tri?.dispose();
    },
  };
}
