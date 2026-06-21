import type {Benchmark, BenchContext} from '../types.js';
import {linkProgram, UBO_VS, TINY_FS} from '../../gl/shaders.js';
import {makeTinyTriangle, type TinyTriangle} from './common.js';

const POOL = 8; // distinct UBO ranges to round-robin through

// Round-robin bindBufferRange() + small UBO updates per draw — the modern
// alternative to many uniform* calls. Scales the bind+update count.
export function makeUboUpdatesBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle;
  let program: WebGLProgram;
  let ubo: WebGLBuffer;
  let blockSize = 0;
  const data = new Float32Array(16); // 4 vec4 = 64 bytes
  return {
    id: 'uboUpdates',
    name: 'UBO updates',
    description: 'Round-robin bindBufferRange() + UBO updates per draw.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl);
      program = linkProgram(gl, UBO_VS, TINY_FS);
      const blockIndex = gl.getUniformBlockIndex(program, 'Data');
      gl.uniformBlockBinding(program, blockIndex, 0);
      // UBO offset alignment varies; pad each range up to the required alignment.
      const align = gl.getParameter(
        gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT,
      ) as number;
      blockSize = Math.ceil(64 / align) * align;
      ubo = gl.createBuffer()!;
      gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
      gl.bufferData(gl.UNIFORM_BUFFER, blockSize * POOL, gl.DYNAMIC_DRAW);
    },
    runFrame(count: number) {
      gl.useProgram(program);
      gl.bindVertexArray(tri.vao);
      const u_color = gl.getUniformLocation(program, 'u_color');
      if (u_color) gl.uniform4f(u_color, 0.7, 0.6, 1, 1);
      gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
      for (let i = 0; i < count; i++) {
        const slot = i % POOL;
        const off = slot * blockSize;
        data[0] = i * 0.001;
        gl.bufferSubData(gl.UNIFORM_BUFFER, off, data);
        gl.bindBufferRange(gl.UNIFORM_BUFFER, 0, ubo, off, 64);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    },
    dispose() {
      gl?.deleteBuffer(ubo);
      gl?.deleteProgram(program);
      tri?.dispose();
    },
  };
}
