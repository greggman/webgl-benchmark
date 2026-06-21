import type {Benchmark, BenchContext} from '../types.js';
import {linkProgram, TINY_VS, TINY_FS} from '../../gl/shaders.js';
import {TRI_VERTS} from './common.js';

// The pre-VAO pattern: re-specify bindBuffer + vertexAttribPointer +
// enableVertexAttribArray for every draw. Many engines still do this; it stresses
// the attribute-setup validation path.
export function makeVertexAttribSetupBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let program: WebGLProgram;
  let vao: WebGLVertexArrayObject; // a single VAO we keep re-specifying
  let vbo: WebGLBuffer;
  let loc = 0;
  let u_color: WebGLUniformLocation | null = null;
  let u_offset: WebGLUniformLocation | null = null;
  return {
    id: 'vertexAttribSetup',
    name: 'vertexAttrib setup',
    description:
      'bindBuffer + vertexAttribPointer + enable re-specified per draw.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      program = linkProgram(gl, TINY_VS, TINY_FS);
      u_color = gl.getUniformLocation(program, 'u_color');
      u_offset = gl.getUniformLocation(program, 'u_offset');
      loc = gl.getAttribLocation(program, 'a_pos');
      vbo = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, TRI_VERTS, gl.STATIC_DRAW);
      vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
    },
    runFrame(count: number) {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform4f(u_color, 1, 0.5, 0.7, 1);
      gl.uniform2f(u_offset, 0, 0);
      for (let i = 0; i < count; i++) {
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    },
    dispose() {
      gl?.deleteBuffer(vbo);
      gl?.deleteVertexArray(vao);
      gl?.deleteProgram(program);
    },
  };
}
