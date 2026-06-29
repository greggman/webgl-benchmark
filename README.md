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
| `syncRoundTrip` | `getError()`/`getParameter()` flush+wait cost |
| `createDeleteBuffers` | allocate + fill + delete a 64 KiB buffer, per op |
| `createDeleteTextures` | allocate + fill + delete a 128×128 texture, per op |

Benches marked *(ext)* auto-skip when the required extension is missing. The
`createDelete*` benches stress the GPU process's memory **allocation/deallocation**
path — useful for surfacing GPU-process changes that pure call-issue benches can't.

## How it works

For each selected benchmark the runner does **init → warmup → calibrate →
measure**:

- **warmup** runs a few frames so the implementation can lazily compile shaders,
  link programs, and allocate buffers/textures (those timings are discarded).
- **count** — how much work each benchmark does per frame is **fixed**, not
  re-calibrated every run. Re-calibrating was the single biggest source of run-to-run
  noise (the count landed differently each run, and throughput scales with it). The
  counts are **bundled into the page** (`src/bench/defaultCounts.json`), so every run
  — and, crucially, every *browser build* that loads the page — does identical work.
  That makes A/B comparisons (run build A, run build B, compare) valid. For browser
  A/B work the page is shared by both builds, but their `localStorage` is not, so the
  counts deliberately live in the page, not in storage. **Recalibrate** re-picks
  counts for this machine on the next run; **Copy link** gives you a `?counts=…` URL
  that pins them — open it in both builds to guarantee identical work. Regenerate the
  bundled defaults for your machine with `npm run counts`.
- **measure** keeps the GPU pipe full (a few frames in flight) and runs several
  short **wall-clock windows**, reporting the **median** window's operations/second
  as *ops ÷ wall time, with the work drained (fences) inside the window*. The first
  window is dropped as settle time, and each result reports **Noise** (coefficient of
  variation across the kept windows) and the **time** it took to run.

> **We measure GPU-process throughput, not just call-issue cost.** A command takes
> nanoseconds to *issue* in JavaScript, but it's then sent to the GPU process and
> worked on there — uploading, updating a UBO, allocating or freeing memory. A
> benchmark that times only the JS call is blind to that, so two builds of the same
> implementation can score identically even when one's GPU process is slower. We
> therefore include the GPU completion: the wall-clock window counts the time for the
> issued work to actually drain through the pipe. The throughput tracks how fast the
> implementation *completes* the work.
>
> Tradeoff: for benches whose per-frame work is far below a display-refresh interval,
> the rAF-paced fence polling caps the rate and adds some vsync quantization. For the
> GPU-bound benches this matters for (uploads, UBO updates, alloc/free), the GPU
> completion dominates and the number is meaningful. This makes it suitable for
> A/B comparisons of an implementation: run before a change, run after, compare —
> the alloc/upload/UBO benches move when the GPU-process cost moves.

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
- CI runs the Puppeteer smoke test on the runner's **real GPU** (macOS runners have
  one). It does not use SwiftShader — that's deprecated in Chrome and far too slow
  per frame for the drain-between-frames runner. The test checks each benchmark
  runs and produces a finite positive score, not its perf.
