// WebGL2 context creation + feature/extension probing.

export interface GLInfo {
  vendor: string;
  renderer: string; // UNMASKED_RENDERER_WEBGL when available
  version: string;
  glslVersion: string;
  maxTextureSize: number;
  extensions: string[];
}

export interface GLEnv {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  isWebGL2: true;
  info: GLInfo;
  // Cached, lazily-enabled extension objects keyed by name.
  ext(name: string): unknown | null;
  has(name: string): boolean;
}

const CONTEXT_ATTRS: WebGLContextAttributes = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
  desynchronized: false,
};

export class WebGL2RequiredError extends Error {
  constructor() {
    super('WebGL2 is required but this browser/device did not provide it.');
    this.name = 'WebGL2RequiredError';
  }
}

export function createGLEnv(canvas: HTMLCanvasElement): GLEnv {
  const gl = canvas.getContext(
    'webgl2',
    CONTEXT_ATTRS,
  ) as WebGL2RenderingContext | null;
  if (!gl) throw new WebGL2RequiredError();

  const extCache = new Map<string, unknown>();
  const enable = (name: string): unknown | null => {
    if (extCache.has(name)) return extCache.get(name) ?? null;
    const obj = gl.getExtension(name);
    extCache.set(name, obj ?? null);
    return obj;
  };

  const supported = new Set(gl.getSupportedExtensions() ?? []);

  return {
    gl,
    canvas,
    isWebGL2: true,
    info: readInfo(gl, supported),
    ext: enable,
    has: (name: string) => supported.has(name),
  };
}

function readInfo(gl: WebGL2RenderingContext, supported: Set<string>): GLInfo {
  let vendor = String(gl.getParameter(gl.VENDOR));
  let renderer = String(gl.getParameter(gl.RENDERER));
  // The masked strings are generic; pull the real GPU name if the browser allows.
  if (supported.has('WEBGL_debug_renderer_info')) {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) || vendor;
      renderer =
        String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || renderer;
    }
  }
  return {
    vendor,
    renderer,
    version: String(gl.getParameter(gl.VERSION)),
    glslVersion: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    extensions: [...supported].sort(),
  };
}

// One-shot error check used at init/teardown of a bench (never in hot loops).
export function checkError(gl: WebGL2RenderingContext, where: string): void {
  const err = gl.getError();
  if (err !== gl.NO_ERROR) {
    throw new Error(`GL error 0x${err.toString(16)} at ${where}`);
  }
}
