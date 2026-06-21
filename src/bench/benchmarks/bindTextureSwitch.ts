import type {Benchmark, BenchContext} from '../types.js';
import {linkProgram, TEX_VS, TEX_FS} from '../../gl/shaders.js';
import {
  makeTinyTriangle,
  makeTexturePool,
  type TinyTriangle,
} from './common.js';

const POOL = 64;

// Round-robin bindTexture() across a pool of tiny textures between draws.
// Isolates texture-bind validation cost.
export function makeBindTextureSwitchBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle;
  let program: WebGLProgram;
  let texes: WebGLTexture[] = [];
  return {
    id: 'bindTextureSwitch',
    name: 'bindTexture switch',
    description:
      'Round-robin bindTexture() across a texture pool between draws.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl); // for VAO geometry
      program = linkProgram(gl, TEX_VS, TEX_FS);
      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0);
      texes = makeTexturePool(gl, POOL, 1);
    },
    runFrame(count: number) {
      gl.useProgram(program);
      gl.bindVertexArray(tri.vao);
      gl.activeTexture(gl.TEXTURE0);
      for (let i = 0; i < count; i++) {
        gl.bindTexture(gl.TEXTURE_2D, texes[i % POOL]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    },
    dispose() {
      for (const t of texes) gl?.deleteTexture(t);
      gl?.deleteProgram(program);
      tri?.dispose();
    },
  };
}
