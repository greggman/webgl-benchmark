import type {Benchmark, BenchContext} from '../types.js';

// Two benches: many small texSubImage2D uploads vs fewer big ones.
function makeTexSubImageBench(
  id: string,
  name: string,
  size: number,
): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tex: WebGLTexture;
  let pixels: Uint8Array;
  return {
    id,
    name,
    description: `Many texSubImage2D() uploads of a ${size}x${size} region.`,
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      pixels = new Uint8Array(size * size * 4);
      for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 7) & 255;
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // Allocate immutable storage once; upload sub-regions per frame.
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    },
    runFrame(count: number) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      for (let i = 0; i < count; i++) {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          size,
          size,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
      }
    },
    dispose() {
      gl?.deleteTexture(tex);
    },
  };
}

export function makeTexSubImageSmallBench(): Benchmark {
  return makeTexSubImageBench('texSubImageSmall', 'texSubImage (small)', 4);
}

export function makeTexSubImageBigBench(): Benchmark {
  return makeTexSubImageBench('texSubImageBig', 'texSubImage (big)', 256);
}
