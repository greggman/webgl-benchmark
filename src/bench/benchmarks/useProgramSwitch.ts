import type {Benchmark, BenchContext} from '../types.js';
import {linkProgram, TINY_FS} from '../../gl/shaders.js';
import {makeTinyTriangle, type TinyTriangle} from './common.js';

const POOL = 16;

// Round-robin useProgram() across a pool of trivially-different programs.
// Isolates program-switch validation cost.
export function makeUseProgramSwitchBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle;
  const programs: WebGLProgram[] = [];
  return {
    id: 'useProgramSwitch',
    name: 'useProgram switch',
    description:
      'Round-robin useProgram() across a pool of programs between draws.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl);
      // Each program differs by a constant so they're genuinely distinct objects.
      for (let i = 0; i < POOL; i++) {
        const vs = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos * 0.01 + vec2(${(i / POOL).toFixed(4)}, 0.0) * 0.001, 0.0, 1.0); }`;
        programs.push(linkProgram(gl, vs, TINY_FS));
      }
    },
    runFrame(count: number) {
      gl.bindVertexArray(tri.vao);
      for (let i = 0; i < count; i++) {
        const p = programs[i % POOL];
        gl.useProgram(p);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    },
    dispose() {
      for (const p of programs) gl?.deleteProgram(p);
      tri?.dispose();
    },
  };
}
