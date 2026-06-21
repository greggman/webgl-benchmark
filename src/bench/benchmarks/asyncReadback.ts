import type {Benchmark, BenchContext} from '../types.js';
import {
  makeTinyTriangle,
  makeFBOPool,
  type TinyTriangle,
  type FBOPool,
} from './common.js';

const RING = 8;
const READ = 4; // bytes read per op (1px RGBA)

// The non-stalling readback path: readPixels into a pixel-pack buffer (PBO),
// insert a fenceSync, and only getBufferSubData once the fence is signalled
// (polled with clientWaitSync timeout 0). Contrast with readPixelsSync, which
// blocks on every call. Scales the number of async readback ops issued.
export function makeAsyncReadbackBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tri: TinyTriangle;
  let pool: FBOPool;
  let pbos: WebGLBuffer[] = [];
  let fences: (WebGLSync | null)[] = [];
  let cursor = 0;
  const out = new Uint8Array(READ);
  return {
    id: 'asyncReadback',
    name: 'async readback (PBO)',
    description:
      'readPixels into a PBO + fenceSync, resolved without stalling.',
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      tri = makeTinyTriangle(gl);
      pool = makeFBOPool(gl, 1, 4);
      for (let i = 0; i < RING; i++) {
        const pbo = gl.createBuffer()!;
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, READ, gl.STREAM_READ);
        pbos.push(pbo);
        fences.push(null);
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    },
    runFrame(count: number) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, pool.fbos[0]);
      gl.viewport(0, 0, 4, 4);
      gl.useProgram(tri.program);
      gl.bindVertexArray(tri.vao);
      gl.uniform4f(tri.u_color, 0.3, 1, 0.5, 1);
      gl.uniform2f(tri.u_offset, 0, 0);
      for (let i = 0; i < count; i++) {
        const slot = cursor % RING;
        cursor++;
        // If this slot has an outstanding fence, try to resolve it without blocking.
        const prev = fences[slot];
        if (prev) {
          const status = gl.clientWaitSync(prev, 0, 0);
          if (
            status === gl.ALREADY_SIGNALED ||
            status === gl.CONDITION_SATISFIED
          ) {
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbos[slot]);
            gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
          }
          gl.deleteSync(prev);
          fences[slot] = null;
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbos[slot]);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        fences[slot] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    dispose() {
      for (const f of fences) if (f) gl.deleteSync(f);
      for (const p of pbos) gl?.deleteBuffer(p);
      fences = [];
      pbos = [];
      pool?.dispose();
      tri?.dispose();
    },
  };
}
