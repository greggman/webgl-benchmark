// Shared helpers for benchmarks: tiny geometry, texture pools, render targets.
import {linkProgram, TINY_VS, TINY_FS} from '../../gl/shaders.js';

// A sub-pixel triangle in clip space. Three vertices, used everywhere.
export const TRI_VERTS = new Float32Array([-1, -1, 1, -1, 0, 1]);

export interface TinyTriangle {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  u_offset: WebGLUniformLocation | null;
  u_color: WebGLUniformLocation | null;
  dispose(): void;
}

// Build the standard tiny-triangle program + VAO using the shared TINY shaders.
export function makeTinyTriangle(gl: WebGL2RenderingContext): TinyTriangle {
  const program = linkProgram(gl, TINY_VS, TINY_FS);
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, TRI_VERTS, gl.STATIC_DRAW);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const loc = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return {
    program,
    vao,
    vbo,
    u_offset: gl.getUniformLocation(program, 'u_offset'),
    u_color: gl.getUniformLocation(program, 'u_color'),
    dispose() {
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}

// A small index buffer (3 indices) for drawElements-style benches.
export function makeIndexBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array([0, 1, 2]),
    gl.STATIC_DRAW,
  );
  return ibo;
}

// Create N tiny solid-color textures for bind-switching benches.
export function makeTexturePool(
  gl: WebGL2RenderingContext,
  n: number,
  size = 1,
): WebGLTexture[] {
  const out: WebGLTexture[] = [];
  for (let i = 0; i < n; i++) {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const px = new Uint8Array(size * size * 4);
    for (let p = 0; p < px.length; p += 4) {
      px[p] = (i * 37) & 255;
      px[p + 1] = (i * 71) & 255;
      px[p + 2] = (i * 113) & 255;
      px[p + 3] = 255;
    }
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      size,
      size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      px,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    out.push(tex);
  }
  return out;
}

// A pool of tiny framebuffers each backed by a small color texture.
export interface FBOPool {
  fbos: WebGLFramebuffer[];
  dispose(): void;
}

export function makeFBOPool(
  gl: WebGL2RenderingContext,
  n: number,
  size = 4,
): FBOPool {
  const fbos: WebGLFramebuffer[] = [];
  const texes: WebGLTexture[] = [];
  for (let i = 0; i < n; i++) {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      size,
      size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    fbos.push(fbo);
    texes.push(tex);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {
    fbos,
    dispose() {
      for (const f of fbos) gl.deleteFramebuffer(f);
      for (const t of texes) gl.deleteTexture(t);
    },
  };
}

// Vary a color a bit per index so the canvas shows movement while running.
export function colorFor(i: number): [number, number, number, number] {
  const t = i * 0.013;
  return [
    0.5 + 0.5 * Math.sin(t),
    0.5 + 0.5 * Math.sin(t + 2),
    0.5 + 0.5 * Math.sin(t + 4),
    1,
  ];
}
