import type {Benchmark, BenchContext} from '../types.js';

// Two benches share this implementation: many small uploads vs fewer big ones.
function makeBufferSubDataBench(
  id: string,
  name: string,
  bytes: number,
  ringSlots: number,
): Benchmark {
  let gl!: WebGL2RenderingContext;
  let buffer: WebGLBuffer;
  let payload: Float32Array;
  let ringBytes = 0;
  return {
    id,
    name,
    description: `Many bufferSubData() uploads of ${bytes >= 1024 ? bytes / 1024 + ' KiB' : bytes + ' bytes'} each.`,
    async init(ctx: BenchContext) {
      gl = ctx.gl;
      payload = new Float32Array(bytes / 4);
      for (let i = 0; i < payload.length; i++) payload[i] = i * 0.001;
      // Ring through several offsets so we exercise sub-range uploads, not just
      // overwriting offset 0 (which some drivers special-case).
      ringBytes = bytes * ringSlots;
      buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, ringBytes, gl.DYNAMIC_DRAW);
    },
    runFrame(count: number) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (let i = 0; i < count; i++) {
        const off = (i % ringSlots) * bytes;
        gl.bufferSubData(gl.ARRAY_BUFFER, off, payload);
      }
    },
    dispose() {
      gl?.deleteBuffer(buffer);
    },
  };
}

export function makeBufferSubDataSmallBench(): Benchmark {
  return makeBufferSubDataBench(
    'bufferSubDataSmall',
    'bufferSubData (small)',
    16,
    256,
  );
}

export function makeBufferSubDataBigBench(): Benchmark {
  // 1 MiB payload; only a few ring slots to keep memory reasonable.
  return makeBufferSubDataBench(
    'bufferSubDataBig',
    'bufferSubData (big)',
    1 << 20,
    3,
  );
}
