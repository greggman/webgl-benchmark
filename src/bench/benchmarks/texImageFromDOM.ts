import type {Benchmark, BenchContext} from '../types.js';

const SIZE = 128;

// Upload from a decoded DOM image (an ImageBitmap) many times — the DOM-element
// import path, which goes through color conversion / premultiply handling.
export function makeTexImageFromDOMBench(): Benchmark {
  let gl!: WebGL2RenderingContext;
  let tex: WebGLTexture;
  let bitmap: ImageBitmap;
  return {
    id: 'texImageFromDOM',
    name: 'texImage from ImageBitmap',
    description: `Uploading a decoded ${SIZE}x${SIZE} ImageBitmap repeatedly.`,
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      // Build a gradient on an offscreen canvas, then decode to an ImageBitmap.
      const c = new OffscreenCanvas(SIZE, SIZE);
      const g = c.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, SIZE, SIZE);
      grad.addColorStop(0, '#3af');
      grad.addColorStop(1, '#fa3');
      g.fillStyle = grad;
      g.fillRect(0, 0, SIZE, SIZE);
      bitmap = await createImageBitmap(c);
      tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    },
    runFrame(count: number) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      for (let i = 0; i < count; i++) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          bitmap,
        );
      }
    },
    dispose() {
      gl?.deleteTexture(tex);
      bitmap?.close();
    },
  };
}
