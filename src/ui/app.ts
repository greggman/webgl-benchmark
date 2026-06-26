import type {GLEnv} from '../gl/context.js';
import type {
  BenchContext,
  BenchResult,
  RunData,
  RunnerConfig,
} from '../bench/types.js';
import {DEFAULT_CONFIG, FAST_CONFIG} from '../bench/types.js';
import {GROUPS, createAllBenchmarks} from '../bench/registry.js';
import {
  runBenchmark,
  CancelledError,
  type ProgressEvent,
} from '../bench/runner.js';
import {applyScores} from './score.js';
import {renderResults, escapeHtml} from './results.js';
import {ComparePanel} from './compare.js';

export class App {
  private ctx: BenchContext;
  private selectEl: HTMLElement;
  private progressEl: HTMLElement;
  private resultsEl: HTMLElement;
  private compare: ComparePanel;
  private running = false;
  private cancelRequested = false;
  // Which benchmarks are unsupported on this device (disabled in the UI).
  private supportedIds = new Set<string>();

  constructor(
    private env: GLEnv,
    root: HTMLElement,
  ) {
    this.ctx = {
      gl: env.gl,
      canvas: env.canvas,
      env,
      has: n => env.has(n),
    };

    root.innerHTML = `
      <div id="select" class="panel"></div>
      <div id="progress" class="panel hidden"></div>
      <div id="results"></div>
      <div id="compare"></div>`;

    this.selectEl = root.querySelector('#select')!;
    this.progressEl = root.querySelector('#progress')!;
    this.resultsEl = root.querySelector('#results')!;
    this.compare = new ComparePanel(root.querySelector('#compare')!);

    this.probeSupport();
    this.renderSelection();
  }

  // Instantiate each bench once to ask supported(); cheap and avoids surprises.
  private probeSupport(): void {
    for (const b of createAllBenchmarks()) {
      const ok = !b.supported || b.supported(this.ctx);
      if (ok) this.supportedIds.add(b.id);
      try {
        b.dispose();
      } catch {
        /* nothing allocated yet */
      }
    }
  }

  private renderSelection(): void {
    const groups = GROUPS.map(g => {
      const items = g.factories
        .map(f => f())
        .map(b => {
          const supported = this.supportedIds.has(b.id);
          const badge = supported
            ? ''
            : '<span class="badge">unavailable</span>';
          return `<label class="bench-item ${supported ? '' : 'unsupported'}">
            <input type="checkbox" value="${b.id}" ${supported ? 'checked' : 'disabled'} />
            <span>
              <span class="name">${escapeHtml(b.name)}${badge}</span>
              <span class="desc">${escapeHtml(b.description)}</span>
            </span>
          </label>`;
        })
        .join('');
      return `<h2 class="bench-section">${escapeHtml(g.title)}</h2><div class="bench-grid">${items}</div>`;
    }).join('');

    this.selectEl.innerHTML = `
      <h2>WebGL implementation: ${escapeHtml(this.env.info.renderer)}</h2>
      ${groups}
      <div class="toolbar">
        <button id="all">Select all</button>
        <button id="none">Select none</button>
        <span class="spacer"></span>
        <input id="label" type="text" placeholder="run label (optional)" />
        <button id="run" class="primary">Run selected</button>
      </div>`;

    const $ = <T extends HTMLElement>(s: string) =>
      this.selectEl.querySelector<T>(s)!;
    const boxes = () =>
      Array.from(
        this.selectEl.querySelectorAll<HTMLInputElement>(
          'input[type=checkbox]:not(:disabled)',
        ),
      );
    $('#all').addEventListener('click', () =>
      boxes().forEach(b => (b.checked = true)),
    );
    $('#none').addEventListener('click', () =>
      boxes().forEach(b => (b.checked = false)),
    );
    $<HTMLButtonElement>('#run').addEventListener('click', () => {
      const ids = boxes()
        .filter(b => b.checked)
        .map(b => b.value);
      const label = $<HTMLInputElement>('#label').value.trim();
      void this.run(ids, label);
    });
  }

  private setProgress(html: string): void {
    this.progressEl.innerHTML = html;
  }

  private renderProgress(ev: ProgressEvent | null, cancelable: boolean): void {
    const pct = ev ? Math.round(ev.fraction * 100) : 0;
    const line = ev
      ? `${ev.index + 1}/${ev.total} · ${escapeHtml(ev.benchName)} · ${ev.phase}${ev.message ? ' — ' + escapeHtml(ev.message) : ''}`
      : 'starting…';
    this.setProgress(`
      <div class="progress">${line}</div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      ${cancelable ? '<button id="cancel">Cancel</button>' : ''}`);
    const cancel = this.progressEl.querySelector<HTMLButtonElement>('#cancel');
    cancel?.addEventListener('click', () => {
      this.cancelRequested = true;
      cancel.disabled = true;
    });
  }

  // Run the selected benchmarks. `config` lets the test harness pass FAST_CONFIG.
  async run(
    ids: string[],
    label: string,
    config: RunnerConfig = DEFAULT_CONFIG,
  ): Promise<RunData | null> {
    if (this.running || ids.length === 0) return null;
    this.running = true;
    this.cancelRequested = false;
    this.env.canvas.classList.add('running');
    this.progressEl.classList.remove('hidden');
    this.resultsEl.innerHTML = '';
    this.renderProgress(null, true);

    const selected = new Set(ids);
    const benches = createAllBenchmarks().filter(b => selected.has(b.id));
    const results: BenchResult[] = [];

    try {
      for (let i = 0; i < benches.length; i++) {
        const res = await runBenchmark(
          benches[i],
          this.ctx,
          config,
          i,
          benches.length,
          {
            onProgress: ev => this.renderProgress(ev, true),
            shouldCancel: () => this.cancelRequested,
          },
        );
        results.push(res);
      }
    } catch (err) {
      if (!(err instanceof CancelledError)) {
        this.setProgress(
          `<p class="error">Run failed: ${escapeHtml(String(err))}</p>`,
        );
        this.finish();
        return null;
      }
    }

    const overall = applyScores(results);
    const run: RunData = {
      label: label || new Date().toLocaleString(),
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      info: {
        vendor: this.env.info.vendor,
        renderer: this.env.info.renderer,
        version: this.env.info.version,
        glslVersion: this.env.info.glslVersion,
        userAgent: navigator.userAgent,
      },
      results,
      overall,
    };

    renderResults(this.resultsEl, run);
    this.addDownloadButton(run);
    this.compare.addRun(run);
    this.finish();
    return run;
  }

  private addDownloadButton(run: RunData): void {
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    const btn = document.createElement('button');
    btn.textContent = 'Download JSON';
    btn.addEventListener('click', () => {
      void import('./storage.js').then(m => m.downloadRun(run));
    });
    bar.appendChild(btn);
    this.resultsEl.querySelector('.panel')?.appendChild(bar);
  }

  private finish(): void {
    this.running = false;
    this.env.canvas.classList.remove('running');
    this.progressEl.classList.add('hidden');
  }
}

export {FAST_CONFIG};
