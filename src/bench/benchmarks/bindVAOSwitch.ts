import type {Benchmark, BenchContext} from '../types.js';
import {linkProgram, TINY_VS, TINY_FS} from '../../gl/shaders.js';
import {TRI_VERTS} from './common.js';

const POOL = 64;

// Round-robin bindVertexArray() across a VAO pool between draws.
export function makeBindVAOSwitchBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let program: WebGLProgram;
  const vaos: WebGLVertexArrayObject[] = [];
  const buffers: WebGLBuffer[] = [];
  let u_color: WebGLUniformLocation | null = null;
  let u_offset: WebGLUniformLocation | null = null;
  return {
    id: 'bindVAOSwitch',
    name: 'bindVertexArray switch',
    description:
      'Round-robin bindVertexArray() across a VAO pool between draws.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      program = linkProgram(gl, TINY_VS, TINY_FS);
      u_color = gl.getUniformLocation(program, 'u_color');
      u_offset = gl.getUniformLocation(program, 'u_offset');
      const loc = gl.getAttribLocation(program, 'a_pos');
      for (let i = 0; i < POOL; i++) {
        const vbo = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, TRI_VERTS, gl.STATIC_DRAW);
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        vaos.push(vao);
        buffers.push(vbo);
      }
      gl.bindVertexArray(null);
    },
    runFrame(count: number) {
      gl.useProgram(program);
      gl.uniform4f(u_color, 0.8, 0.9, 0.4, 1);
      gl.uniform2f(u_offset, 0, 0);
      for (let i = 0; i < count; i++) {
        gl.bindVertexArray(vaos[i % POOL]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    },
    dispose() {
      for (const v of vaos) gl?.deleteVertexArray(v);
      for (const b of buffers) gl?.deleteBuffer(b);
      gl?.deleteProgram(program);
    },
  };
}
