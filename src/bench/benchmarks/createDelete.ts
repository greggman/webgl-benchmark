import type {Benchmark, BenchContext} from '../types.js';

// Create + delete GPU resources every frame to stress the implementation's memory
// allocation / DEALLOCATION path — which is mostly GPU-process work, not renderer-
// side API cost. Each resource is given real backing storage (so the driver can't
// elide the allocation) and then deleted the same frame. The unit scaled (`count`)
// is the number of create/delete cycles per frame.
//
// These are aimed at surfacing GPU-process changes (e.g. how fast freed memory is
// reclaimed) that pure call-issue benchmarks can't see.

const BUF_BYTES = 1 << 16; // 64 KiB per buffer
const TEX_SIZE = 128; // 128x128 RGBA = 64 KiB per texture

export function makeCreateDeleteBuffersBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let data: Uint8Array;
  return {
    id: 'createDeleteBuffers',
    name: 'create/delete buffers',
    description: `Allocate (${BUF_BYTES >> 10} KiB), fill, and delete a buffer, per op.`,
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      data = new Uint8Array(BUF_BYTES);
    },
    runFrame(count: number) {
      for (let i = 0; i < count; i++) {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        // bufferData forces the storage to actually be allocated…
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.deleteBuffer(b); // …and deleteBuffer frees it (GPU-process work).
      }
    },
    dispose() {
      /* nothing retained */
    },
  };
}

export function makeCreateDeleteTexturesBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let pixels: Uint8Array;
  return {
    id: 'createDeleteTextures',
    name: 'create/delete textures',
    description: `Allocate (${TEX_SIZE}x${TEX_SIZE}), fill, and delete a texture, per op.`,
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      pixels = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);
    },
    runFrame(count: number) {
      for (let i = 0; i < count; i++) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          TEX_SIZE,
          TEX_SIZE,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        gl.deleteTexture(t);
      }
    },
    dispose() {
      /* nothing retained */
    },
  };
}
