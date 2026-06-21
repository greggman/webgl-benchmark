# WebGL Benchmark

A browser benchmark suite that measures the performance of the **WebGL
implementation** — the CPU-side cost of issuing API calls, changing state, and
uploading data — rather than the raw throughput of the GPU.

> Why "not the GPU"? A shadertoy-style shader or a million-instance draw is bound
> by the GPU; it tells you little about the WebGL layer. Each benchmark here keeps
> the per-call GPU work trivial (sub-pixel triangles, tiny textures) and scales the
> **number of API operations**, so the measured cost reflects validation, command
> serialization, and the round-trips WebGL makes to the GPU process.

WebGL is an immediate-mode, *stateful* API, so the suite leans heavily on the costs
that dominate real WebGL apps: **state changes** (`useProgram`, `bindTexture`,
`bindVertexArray`, `vertexAttribPointer`, `uniform*`, …) and **synchronous
round-trips** (`readPixels`, `getError`, `getParameter`), alongside the usual draw
and upload paths.

## Benchmarks

| id | what it stresses |
|----|------------------|
| `draw` | many `drawArrays()` calls |
| `drawElements` | many `drawElements()` calls |
| `drawInstanced` | many instanced draws with tiny instance counts |
| `multiDraw` | many sub-draws via `multiDrawArraysWEBGL` *(ext)* |
| `uniformUpdates` | many `uniform4fv()` updates per draw |
| `uboUpdates` | `bindBufferRange()` + UBO updates per draw |
| `bindTextureSwitch` | round-robin `bindTexture()` between draws |
| `useProgramSwitch` | round-robin `useProgram()` between draws |
| `bindVAOSwitch` | round-robin `bindVertexArray()` between draws |
| `vertexAttribSetup` | `bindBuffer` + `vertexAttribPointer` re-specified per draw |
| `stateChange` | `enable/disable` + `blendFunc/depthFunc` churn |
| `viewportScissor` | many `viewport()`/`scissor()` calls between draws |
| `fboSwitch` | many `bindFramebuffer()` + clear/draw pairs |
| `bufferSubDataSmall` | many small `bufferSubData()` uploads |
| `bufferSubDataBig` | fewer large (1 MiB) `bufferSubData()` uploads |
| `texSubImageSmall` | many small (4×4) `texSubImage2D()` uploads |
| `texSubImageBig` | fewer large (256×256) `texSubImage2D()` uploads |
| `texImageFromDOM` | repeated upload from a decoded `ImageBitmap` |
| `readPixelsSync` | synchronous 1×1 `readPixels()` round-trips |
| `asyncReadback` | non-stalling readback via PBO + `fenceSync` |
| `syncRoundTrip` | `getError()`/`getParameter()` flush+wait cost |

Benches marked *(ext)* auto-skip when the required extension is missing.

## How it works

For each selected benchmark the runner does **init → warmup → calibrate →
measure**:

- **warmup** runs a few frames so the implementation can lazily compile shaders,
  link programs, and allocate buffers/textures (those timings are discarded).
- **calibrate** picks a per-frame operation `count` that targets a modest amount of
  CPU time per frame, keeping the GPU underutilized.
- **measure** runs several short windows, recording the **CPU time to issue +
  flush** each frame, and reports the **median** window's operations/second. The
  first window is dropped as settle time, and each result reports **Noise** (the
  coefficient of variation across the kept windows) so you can see how stable a
  number is.

> **Why not `finish()` every frame?** Draining the pipe each frame measures
> *start + stop* latency, not throughput: every frame runs from an idle GPU and the
> implementation never gets to pipeline submissions the way a real app does. We
> only `flush()` per frame and `finish()` at window boundaries.
>
> Synchronous calls (`readPixels`, `getError`, `getParameter`, `getBufferSubData`)
> force a GPU-process round-trip and stall the pipeline, so they live **only** in
> the dedicated round-trip benchmarks (`readPixelsSync`, `asyncReadback`,
> `syncRoundTrip`) and never inside the throughput benches' hot loops.

When `EXT_disjoint_timer_query_webgl2` is available, each frame is also timed on the
GPU to confirm we're not GPU-bound; a result is flagged **GPU-bound?** if the GPU is
busy nearly as long as the CPU frame. The extension is commonly absent (e.g. on many
macOS/Metal configs), in which case this check is simply skipped.

Each benchmark's operations/second is normalized against a baked-in reference
baseline (`src/ui/baseline.json`) so a score near **1000 matches the reference
machine and higher is better**. The **overall** score is the geometric mean of the
per-benchmark scores; skipped benches are excluded so machines with different
extension support still compare on their intersection.

## Usage

```bash
npm install
npm run dev        # build + watch + serve on a free port
npm run build      # production build into dist/
npm run serve      # serve an existing dist/
npm test           # Puppeteer smoke test (fast measurement window per benchmark)
npm run typecheck
npm run baseline   # regenerate src/ui/baseline.json from a full run on this machine
```

In the UI: choose benchmarks (all supported ones on by default) and click **Run
selected**. Results show per-benchmark scores and an overall score, with a
**Download JSON** button. Past runs are saved in **History** (`localStorage`), where
each run can be relabeled, downloaded, deleted, or added to the comparison. You can
also **drag & drop** exported JSON files into the *Compare runs* panel to see
per-benchmark deltas.

### Scoring baseline

Scores are normalized against `src/ui/baseline.json` (bundled at build time): a
score of ~1000 means "matches the baseline machine", higher is better. To recenter
scoring on your own hardware:

```bash
npm run baseline   # runs the full suite headless on the real GPU, writes baseline.json
npm run build      # rebuild to bundle the new baseline
```

The committed baseline values are rough placeholders — regenerate them to make
scores meaningful for your setup.

## Notes

- Requires a browser with **WebGL2** (`navigator.gpu` is *not* used).
- CI runs the Puppeteer smoke test under SwiftShader, which validates the API path
  (correctness, not perf). `WEBGL_multi_draw` and the timer-query extension may be
  absent there, so those benches report as skipped rather than failing.
