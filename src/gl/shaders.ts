// Shader compile/link helpers plus a couple of tiny shared programs. Every
// benchmark keeps its fragment work trivial so the GPU is never the bottleneck.

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile error: ${log}\n${source}`);
  }
  return sh;
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  if (!prog) throw new Error('createProgram failed');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  // Shaders can be deleted once linked; the program keeps what it needs.
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error: ${log}`);
  }
  return prog;
}

// GLSL ES 3.00 header (WebGL2).
const V300 = '#version 300 es\n';
const F300 = '#version 300 es\nprecision highp float;\n';

// A minimal program: one position attribute, a color uniform, sub-pixel output.
// Used by the draw-call and most state-change benches.
export const TINY_VS = `${V300}
in vec2 a_pos;
uniform vec2 u_offset;
void main() {
  // Keep geometry sub-pixel-tiny so the GPU does almost no work.
  gl_Position = vec4(a_pos * 0.01 + u_offset, 0.0, 1.0);
}`;

export const TINY_FS = `${F300}
uniform vec4 u_color;
out vec4 outColor;
void main() {
  outColor = u_color;
}`;

// A program with many uniforms, for the uniform-update benchmark.
export function manyUniformVS(n: number): string {
  const decls = Array.from({length: n}, (_, i) => `uniform vec4 u_v${i};`).join(
    '\n',
  );
  const sum = Array.from({length: n}, (_, i) => `u_v${i}`).join(' + ');
  return `${V300}
in vec2 a_pos;
${decls}
void main() {
  vec4 s = ${sum};
  gl_Position = vec4(a_pos * 0.01 + s.xy * 0.0001, 0.0, 1.0);
}`;
}

// A program reading from a UBO block, for the UBO-update benchmark.
export const UBO_VS = `${V300}
in vec2 a_pos;
layout(std140) uniform Data {
  vec4 u_data[4];
};
void main() {
  gl_Position = vec4(a_pos * 0.01 + u_data[0].xy * 0.0001, 0.0, 1.0);
}`;

// A program that samples one texture, for texture-bind benches.
export const TEX_VS = `${V300}
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos * 0.01, 0.0, 1.0);
}`;

export const TEX_FS = `${F300}
uniform sampler2D u_tex;
out vec4 outColor;
void main() {
  outColor = texelFetch(u_tex, ivec2(0, 0), 0);
}`;
