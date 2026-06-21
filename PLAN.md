# WebGL Benchmark — Build Plan

A browser benchmark suite that measures the performance of the **WebGL
implementation** (the CPU-side cost of issuing API calls, changing state, uploading
data, and the round-trips to the GPU process) rather than raw GPU compute/fill
throughput. Inspired by 3DMark / MotionMark.

## 0. Guiding principle: measure WebGL, not the GPU

Every benchmark must be **CPU/driver bound, not GPU bound**. The work done *per draw
/ per upload / per state change* should be trivial for the GPU, so the wall-clock
time is dominated by the cost of the WebGL API call path. We verify this by checking
that the score scales with *call count*, not with *per-call GPU work*.

> Why "not the GPU"? A shadertoy-style fragment shader or a million-instance draw is
> bound by the GPU and tells you little about the WebGL layer. Each benchmark here
> keeps per-call GPU work trivial (1px triangles, tiny textures) and scales the
> **number of API operations**, so the measured cost reflects validation, command
> serialization, and GPU-process round-trips.

Concretely, for each benchmark:
- Geometry/shaders/textures are tiny (a single sub-pixel triangle, a 1×1 viewport, a
  4×4 texture).
- The variable we scale is the **number of API operations** (draws, state changes,
  bufferSubData/texSubImage uploads, …).
- We auto-tune that count during warmup so each benchmark runs at a sane frame rate
  on the host machine (see §4 calibration), keeping the GPU underutilized.

### What the WebGL implementation actually spends time on

WebGL is an immediate-mode, *stateful* API, and that shapes what is worth measuring:

- **State changes are first-class overhead.** Real WebGL apps are dominated by the
  cost of *binding* and *re-specifying* state between draws: `useProgram`,
  `bindTexture`, `bindVertexArray`, `vertexAttribPointer`, `bindBuffer`,
  `uniform*`, `enable/disable`, `blendFunc`, `viewport/scissor`. These get their own
  benchmarks — they are arguably the most important thing to measure for WebGL.
- **Uniform updates are huge.** Setting many `uniform*` / `uniformMatrix4fv` calls
  per draw is one of the biggest real-world WebGL costs, so we benchmark it directly.
- **The command-buffer / round-trip model.** In Chrome, WebGL calls are validated in
  the renderer process and serialized into a command buffer sent to the GPU process.
  The CPU time we measure for a call loop is *validation + serialization*; the actual
  GPU submit happens at flush / `SwapBuffers` (end of `requestAnimationFrame`).
  **Synchronous calls force a round-trip and stall the pipeline**: `readPixels`,
  `getError`, `getParameter`, `finish`, `clientWaitSync`, `getBufferSubData`,
  `fenceSync`-then-wait. These deserve their own "round-trip latency" benchmarks —
  and must **never** be sprinkled into the other benches' hot loops (e.g. no
  `getError` per draw; it would change what we measure).
- **No explicit present.** The default framebuffer is presented automatically at the
  end of the `rAF` callback by the compositor; there is no manual swap and no
  app-controlled frames-in-flight. We keep the pipe full simply by **not** calling
  `finish()` every frame (see §4), and only lightly sync at window boundaries.
- **WebGL2 is the primary target.** ES 3.0 gives us VAOs, UBOs, instancing, MRT,
  transform feedback, sync objects, and PBOs (for async readback). We require WebGL2
  for the full suite and feature-detect per bench; benches that need an extension
  (`WEBGL_multi_draw`, `EXT_disjoint_timer_query_webgl2`) gracefully **skip** when it
  is absent rather than failing the run. A WebGL1-only fallback may run a reduced set.

## 1. Tech stack & repo layout

- **TypeScript@latest**, bundled with **esbuild@latest**. No framework — plain DOM +
  WebGL2.
- **Dev server**: a tiny Node static server that picks a free port using
  `get-free-port.mjs` (copy from `/Users/gregg/src/sedon/scripts/get-free-port.mjs`
  into `scripts/`).
- **Tests**: Puppeteer, headless Chrome. WebGL2 runs reliably under SwiftShader
  (`--use-gl=angle --use-angle=swiftshader`) on CI, or on hardware on macOS.
- **CI/CD**: GitHub Actions → build → Puppeteer smoke test → publish `dist/` to
  GitHub Pages.

```
webgl-benchmark/
  package.json
  tsconfig.json
  .github/workflows/deploy.yml
  scripts/
    get-free-port.mjs        # copied from sedon
    serve.mjs                # static server on a free port
    build.mjs                # esbuild build (bundle + copy index.html/css)
    dev.mjs                  # build --watch + serve
  src/
    index.html
    style.css
    main.ts                  # app entry: wires UI + runner
    gl/
      context.ts             # context create (webgl2, attribs), feature/extension probe
      shaders.ts             # tiny shared shader programs, compile/link helpers
      timing.ts              # frame timing, optional disjoint_timer_query, stats
    bench/
      types.ts               # Benchmark interface, BenchResult types
      registry.ts            # list of all benchmarks
      runner.ts              # warmup → calibrate → measure loop
      benchmarks/
        draw.ts
        drawElements.ts
        drawInstanced.ts
        multiDraw.ts          # WEBGL_multi_draw (skip if absent)
        uniformUpdates.ts
        uboUpdates.ts         # WebGL2 UBO / bindBufferRange churn
        bindTextureSwitch.ts
        useProgramSwitch.ts
        bindVAOSwitch.ts      # WebGL2
        vertexAttribSetup.ts  # pre-VAO bindBuffer + vertexAttribPointer churn
        stateChange.ts        # enable/disable + blendFunc/depthFunc churn
        viewportScissor.ts
        fboSwitch.ts          # bindFramebuffer + tiny clear/draw per pass
        bufferSubDataSmall.ts
        bufferSubDataBig.ts
        texSubImageSmall.ts
        texSubImageBig.ts
        texImageFromDOM.ts    # upload from ImageBitmap/Canvas (DOM element path)
        readPixelsSync.ts     # synchronous readback round-trip
        asyncReadback.ts      # WebGL2 PBO + fenceSync + getBufferSubData
        syncRoundTrip.ts      # getError / getParameter / finish stall cost
    ui/
      app.ts                 # selection UI, run button, progress
      results.ts             # score table, overall score
      storage.ts             # localStorage save/load by time+label
      compare.ts             # drag-and-drop JSON compare view
      score.ts               # scoring model (normalize → per-bench + overall)
      baseline.json          # baked-in reference baseline (regenerable)
  test/
    smoke.test.mjs           # puppeteer: run each bench a few frames, assert results
```

## 2. The Benchmark interface

A single shape every benchmark implements so the runner is generic.

```ts
interface BenchContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  isWebGL2: boolean;
  has(ext: string): boolean;        // extension availability
}

interface Benchmark {
  id: string;                 // stable key for storage/compare
  name: string;               // human label
  description: string;
  // optional gate: return false to auto-skip when a feature/extension is missing
  supported?(ctx: BenchContext): boolean;
  // create GL resources once; may be async (image decode for the DOM-upload bench)
  init(ctx: BenchContext): Promise<void>;
  // do exactly `count` units of work for one frame (count = the thing we scale)
  runFrame(count: number): void;
  // cleanup buffers/textures/programs/VAOs/FBOs
  dispose(): void;
}
```

The "unit of work" (`count`) means: draws for `draw`, `uniform*` calls for
`uniformUpdates`, `bindTexture` calls for `bindTextureSwitch`, `bufferSubData` calls
for the upload benches, etc. **Higher score = better**, derived from how many
units/second the implementation sustains (see §5).

## 3. The benchmarks (≈20, grouped)

Each keeps GPU work trivial; we scale the call count. Benches marked *(WebGL2)* or
*(ext)* auto-skip when unavailable.

**Draw-call overhead**
1. **draw** — one program, tiny triangle; `count` `drawArrays()` calls per frame.
2. **drawElements** — same, `drawElements()` against a tiny index buffer.
3. **drawInstanced** *(WebGL2)* — `count` `drawArraysInstanced()` calls each with a
   *tiny* instance count, so the call overhead dominates, not the instancing.
4. **multiDraw** *(ext WEBGL_multi_draw)* — issue the same total sub-draws as `draw`
   but via `multiDrawArraysWEBGL`; reveals how much the multi-draw path saves over N
   individual draws.

**State-change overhead (the WebGL-specific heart of the suite)**
5. **uniformUpdates** — set N `uniform4fv`/`uniformMatrix4fv` per draw; scale the
   uniform-call count. One of the biggest real-world WebGL costs.
6. **uboUpdates** *(WebGL2)* — round-robin `bindBufferRange` + small UBO updates per
   draw; the modern alternative to many `uniform*` calls.
7. **bindTextureSwitch** — round-robin `bindTexture` across a pool of tiny textures
   between draws; texture-bind validation cost.
8. **useProgramSwitch** — round-robin `useProgram` across a pool of trivial programs;
   program-switch cost.
9. **bindVAOSwitch** *(WebGL2)* — round-robin `bindVertexArray` across a VAO pool.
10. **vertexAttribSetup** — the pre-VAO pattern: `bindBuffer` +
    `vertexAttribPointer` + `enableVertexAttribArray` re-specified per draw; scale
    the attribute-setup count.
11. **stateChange** — toggle `enable/disable` (BLEND/DEPTH_TEST/CULL_FACE) +
    `blendFunc`/`depthFunc` between draws.
12. **viewportScissor** — many `viewport()` / `scissor()` calls between tiny draws.

**Render-target / pass overhead**
13. **fboSwitch** — `count` `bindFramebuffer()` + tiny clear/draw pairs across an FBO
    pool; the closest WebGL analog to "many render passes".

**Data upload**
14. **bufferSubDataSmall** — `count` small (16-byte) `bufferSubData()` uploads.
15. **bufferSubDataBig** — `count` large (1–4 MB) `bufferData`/`bufferSubData`
    uploads; bulk staging throughput.
16. **texSubImageSmall** — `count` small (4×4) `texSubImage2D()` uploads.
17. **texSubImageBig** — `count` large (256×256) `texImage2D`/`texSubImage2D`
    uploads.
18. **texImageFromDOM** — upload from a decoded `ImageBitmap`/`<canvas>` `count`
    times; the DOM-element image import path.

**Synchronous round-trips (round-trip latency, not throughput)**
19. **readPixelsSync** — `count` `readPixels()` of a 1×1 region; each forces a flush
    + GPU-process round-trip. Measures stall cost. (Kept deliberately separate so it
    never contaminates throughput benches.)
20. **asyncReadback** *(WebGL2)* — PBO + `fenceSync` + `clientWaitSync(0)` polling +
    `getBufferSubData`; the non-stalling readback path, contrasted with #19.
21. **syncRoundTrip** — `count` `getError()` / `getParameter()` / occasional
    `finish()` calls; isolates the cost of forcing the command buffer to flush and
    wait.

> This is ~21 benchmarks ("10 or so" comfortably exceeded). The selection screen lets
> users pick a subset, so the full set never has to run at once.

**Visual interest**: the draw/state/FBO benches render their tiny primitives to the
canvas with varied colors/positions so the screen shows moving, colorful output while
running. Upload and round-trip benches visualize progress with an animated bar/sprite
driven by the data they move, so the user always sees something happening.

## 4. The runner: warmup → calibrate → measure

For each selected benchmark, in sequence:

1. **init** — create all resources (programs, buffers, textures, VAOs, FBOs). Probe
   `supported()` first and skip with a recorded "skipped (missing X)" status if not.
2. **Warmup** — run a few frames at a low count so the implementation lazily compiles
   shaders, links programs, and allocates buffers/textures; discard these timings.
   (Optionally call `gl.getError()` exactly **once** after init to surface setup bugs,
   never inside the measured loop.)
3. **Calibrate** — find a `count` that targets a stable per-frame CPU time (e.g.
   ~8–12 ms of call-issue time) via a quick doubling/bisection search. This keeps the
   GPU underused and the measurement CPU-bound. Record the chosen `count`.
4. **Measure** — run several short windows; each frame record CPU time
   (`performance.now()` around `runFrame` + the frame's `gl.flush()`). Report the
   **median window's** operations/second and a **Noise** figure (coefficient of
   variation across kept windows). Drop the first window as extra settle time. Compute
   units/sec = `count * frames / elapsed`.

Timing details specific to WebGL:
- **Primary metric is CPU time to issue + serialize the calls** — that is the WebGL
  implementation cost (renderer-side validation + command-buffer writes).
- **Do not `finish()` every frame.** A per-frame `gl.finish()` drains the GPU-process
  pipe and measures *start+stop latency*, not throughput: it runs each frame from an
  idle GPU and never lets the implementation pipeline frames the way a real app does.
  Instead let the browser keep frames pipelined; issue only `gl.flush()` per frame and
  a single `gl.finish()` (or a
  `clientWaitSync`) at **window boundaries** to keep windows from bleeding into each
  other.
- **Optional GPU time** via `EXT_disjoint_timer_query_webgl2`: wrap the frame in a
  timer query to *confirm* the GPU isn't the bottleneck. If GPU time ≈ CPU frame time,
  flag the result "GPU-bound, suspect". Skip gracefully if the extension is absent
  (it commonly is, e.g. on most macOS/Metal-ANGLE configs).
- One `requestAnimationFrame` loop drives everything; the runner is a state machine so
  the UI stays responsive and shows progress.

## 5. Scoring (higher = better)

- Each benchmark produces **operations/second** (draws/sec, uniforms/sec, …).
- Convert to a score: `score = opsPerSecond / baseline[id] * 1000`, where `baseline`
  is a baked-in reference captured once on a reference machine, so ~1000 ≈ baseline
  and bigger is better. Baselines live in `src/ui/baseline.json`, regenerable via
  `npm run baseline`.
- **Overall score** = geometric mean of per-benchmark scores (geomean avoids one
  bench dominating, and is robust to the wide spread between cheap state calls and
  expensive uploads). Skipped benches are excluded from the geomean and noted in the
  result so two machines with different extension support are still comparable on the
  intersection.

## 6. UI / UX

- **Selection screen**: checklist of all benchmarks, **all checked by default**;
  unsupported benches shown disabled with the missing feature named; Run button;
  optional "label" text field for this run.
- **Running**: progress (current bench, frame counter), live canvas, cancel.
- **Results**: table of per-benchmark scores + overall; expandable details (count
  used, CPU ms, optional GPU ms, ops/sec, Noise, GPU-bound flag, skipped reason).
- **Save**: "Download JSON" produces
  `{ label, timestamp, ua, glRenderer, glVersion, extensions, results[] }` (capture
  `UNMASKED_RENDERER_WEBGL` via `WEBGL_debug_renderer_info` when available) and also
  writes to **localStorage** keyed by `time + label`. A "History" panel lists saved
  runs, each reloadable / relabelable / downloadable / deletable / addable to compare.
- **Compare**: a drop zone — drag & drop 2+ JSON files (or pick from history) to
  render a side-by-side grouped-bar comparison per benchmark + overall, with deltas.

## 7. Build & serve scripts

- `scripts/build.mjs`: esbuild bundles `src/main.ts` → `dist/main.js` (ESM, minified
  for prod, sourcemap for dev), copies `index.html`/`style.css`, bundles
  `baseline.json`, sets the correct base path for GitHub Pages.
- `scripts/serve.mjs`: static file server; port via `getFreePort(8080, commonHosts)`
  from the copied `get-free-port.mjs`. Prints the URL.
- `scripts/dev.mjs`: esbuild `--watch` (context.rebuild) + serve, for local dev.
- `package.json` scripts: `build`, `dev`, `serve`, `test`, `typecheck`, `baseline`.

## 8. Testing (Puppeteer)

- `test/smoke.test.mjs`: launch headless Chrome, load the served page, run each
  benchmark in a **fast mode** (a few frames, no long measure window — expose a
  `?test=1` query or `window.__runQuick()` hook).
- Assert: every supported benchmark completes, produces a finite positive score, and
  emits **no GL error** (one `getError()` check at the end of each bench, outside the
  measured loop). Skipped benches report a reason rather than failing. Keep total
  runtime small.
- WebGL2 is well supported under SwiftShader; pass
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` so the test
  validates the **API path** (correctness, not perf) even on GPU-less runners.
  `EXT_disjoint_timer_query_webgl2` and `WEBGL_multi_draw` may be absent there — the
  test must treat those benches as skipped, not failed.

## 9. GitHub Actions → Pages

`.github/workflows/deploy.yml`:
1. `actions/checkout`, `setup-node` (latest LTS), `npm ci`.
2. `npm run typecheck` + `npm run build`.
3. `npm test` (Puppeteer smoke; install Chrome via puppeteer).
4. Upload `dist/` artifact, deploy with `actions/deploy-pages` on push to `main`.
- Set the esbuild/HTML base path so assets resolve under the Pages subpath.

## 10. WebGL best practices (applied throughout)

- Compile/link programs, create buffers, textures, VAOs, and FBOs **once** in `init`;
  reuse per frame; never allocate or compile in the hot loop.
- Prefer **WebGL2** features (VAOs, UBOs, instancing, PBOs) and feature-detect; keep a
  reduced WebGL1 path only where trivial.
- Keep render targets and textures **tiny** so the GPU is never the bottleneck.
- **Never** put synchronous calls (`getError`, `getParameter`, `readPixels`,
  `finish`, `getBufferSubData`) inside throughput benches' hot loops — they force
  GPU-process round-trips and would measure latency, not API throughput. The benches
  whose *point* is that cost (#19–21) are the only place they belong.
- Create the context with explicit attributes: `{ antialias: false, depth: false,
  stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }`
  (each bench enables only what it needs), to minimize incidental per-frame cost.
- Handle `webglcontextlost` / `webglcontextrestored`; surface a clear error and abort
  the run rather than producing garbage numbers.

## 11. Build order (milestones)

1. **Scaffold**: package.json, tsconfig, esbuild build/serve/dev scripts (free port),
   empty `index.html`, context + extension probe, a "hello triangle" to prove the
   pipeline. ✔ when the page renders.
2. **Runner + 1 bench**: implement the `Benchmark` interface, the runner
   (warmup/calibrate/measure with windows + median + Noise), and the `draw` benchmark
   end-to-end with a score. ✔ when a number comes out.
3. **All benchmarks**: implement the rest, each with trivial GPU work, count scaling,
   `supported()` gating, and a bit of visual output.
4. **Scoring + UI**: selection checklist, results table, overall geomean score,
   skipped-bench handling.
5. **Persistence + compare**: JSON download, localStorage history, drag-and-drop
   compare view.
6. **Tests + CI**: Puppeteer quick mode, GitHub Actions, Pages deploy.
7. **Polish**: visuals, GPU-bound sanity flags via timer query, baseline tuning,
   README.

## Open questions / decisions to confirm

- **WebGL1 support**: target WebGL2-only for the full suite (chosen default) and show
  a "WebGL2 required" message on WebGL1-only contexts, vs. shipping a reduced WebGL1
  fallback set. Most state-change and upload benches *would* run on WebGL1, but VAOs,
  UBOs, instancing, PBOs, and MRT would be missing — splitting effort for a shrinking
  audience. Recommend WebGL2-only first, add a fallback later if asked.
- **Scoring baselines**: ship a single reference `baseline.json` now and retune after
  first real runs (chosen default), vs. normalize each run to its own max (less
  comparable across runs).
- **GPU timer queries**: include `EXT_disjoint_timer_query_webgl2` as optional
  confirmation of CPU-bound-ness; gracefully skip when absent (common on macOS).
- **CI GPU**: SwiftShader validates the API path but its perf numbers are meaningless;
  CI asserts correctness/skip-handling only. Real baselines come from
  `npm run baseline` on hardware (e.g. macos-latest, which always has a GPU).
