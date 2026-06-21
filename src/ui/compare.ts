import type {RunData} from '../bench/types.js';
import {ALL_IDS} from '../bench/registry.js';
import {
  loadRuns,
  saveRun,
  deleteRun,
  relabelRun,
  downloadRun,
  runKey,
  isRunData,
} from './storage.js';
import {escapeHtml} from './results.js';

function fmtScore(n: number): string {
  return Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString() : '—';
}

// History list + drag-and-drop import + side-by-side comparison of selected runs.
export class ComparePanel {
  private runs: RunData[] = [];
  private selected = new Set<string>();

  constructor(private container: HTMLElement) {
    this.runs = loadRuns();
    this.render();
  }

  // Called by the app after a fresh benchmark run completes.
  addRun(run: RunData): void {
    this.runs = saveRun(run);
    this.selected.add(runKey(run));
    this.render();
  }

  private nameOf(id: string): string {
    for (const r of this.runs) {
      const hit = r.results.find(x => x.id === id);
      if (hit) return hit.name;
    }
    return id;
  }

  private render(): void {
    const history = this.runs
      .map(r => {
        const k = runKey(r);
        const on = this.selected.has(k) ? 'checked' : '';
        return `<div class="run-pill">
          <label><input type="checkbox" data-key="${escapeHtml(k)}" ${on}/> ${escapeHtml(r.label || 'unlabeled')}</label>
          <span class="progress">${fmtScore(r.overall)}</span>
          <button data-act="dl" data-key="${escapeHtml(k)}" title="Download">⬇</button>
          <button data-act="rl" data-key="${escapeHtml(k)}" title="Rename">✎</button>
          <button data-act="del" data-key="${escapeHtml(k)}" title="Delete">✕</button>
        </div>`;
      })
      .join('');

    this.container.innerHTML = `
      <div class="panel">
        <h2>Compare runs</h2>
        <div id="dropzone" class="dropzone">Drag &amp; drop exported run JSON here to add it to History.</div>
        <div style="margin-top:12px">${history || '<p class="progress">No saved runs yet.</p>'}</div>
        <div id="compareTable"></div>
      </div>`;

    this.wire();
    this.renderTable();
  }

  private wire(): void {
    const dz = this.container.querySelector<HTMLElement>('#dropzone')!;
    dz.addEventListener('dragover', e => {
      e.preventDefault();
      dz.classList.add('over');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('over');
      void this.importFiles(e.dataTransfer?.files);
    });

    this.container
      .querySelectorAll<HTMLInputElement>('input[type=checkbox][data-key]')
      .forEach(cb => {
        cb.addEventListener('change', () => {
          const k = cb.dataset.key!;
          if (cb.checked) this.selected.add(k);
          else this.selected.delete(k);
          this.renderTable();
        });
      });

    this.container
      .querySelectorAll<HTMLButtonElement>('button[data-act]')
      .forEach(btn => {
        btn.addEventListener('click', () => {
          const k = btn.dataset.key!;
          const act = btn.dataset.act;
          if (act === 'del') {
            this.runs = deleteRun(k);
            this.selected.delete(k);
            this.render();
          } else if (act === 'dl') {
            const r = this.runs.find(x => runKey(x) === k);
            if (r) downloadRun(r);
          } else if (act === 'rl') {
            const r = this.runs.find(x => runKey(x) === k);
            const next = prompt('New label', r?.label ?? '');
            if (next !== null) {
              this.runs = relabelRun(k, next);
              this.render();
            }
          }
        });
      });
  }

  private async importFiles(files?: FileList | null): Promise<void> {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        const data = JSON.parse(await file.text());
        if (isRunData(data)) {
          this.runs = saveRun(data);
          this.selected.add(runKey(data));
        } else {
          alert(`${file.name} is not a valid benchmark run.`);
        }
      } catch {
        alert(`Could not parse ${file.name}.`);
      }
    }
    this.render();
  }

  private renderTable(): void {
    const host = this.container.querySelector<HTMLElement>('#compareTable');
    if (!host) return;
    const chosen = this.runs.filter(r => this.selected.has(runKey(r)));
    if (chosen.length < 1) {
      host.innerHTML = '';
      return;
    }

    const head = chosen
      .map(r => `<th class="num">${escapeHtml(r.label || 'unlabeled')}</th>`)
      .join('');

    // One row per benchmark id present in any chosen run; delta vs first run.
    const ids = ALL_IDS.filter(id =>
      chosen.some(r => r.results.some(x => x.id === id && x.status === 'ok')),
    );

    const body = ids
      .map(id => {
        const cells = chosen
          .map((r, i) => {
            const res = r.results.find(x => x.id === id);
            const score = res && res.status === 'ok' ? res.score : NaN;
            let delta = '';
            if (i > 0 && Number.isFinite(score)) {
              const base = chosen[0].results.find(x => x.id === id);
              const bScore = base && base.status === 'ok' ? base.score : NaN;
              if (Number.isFinite(bScore) && bScore > 0) {
                const pct = ((score - bScore) / bScore) * 100;
                const cls = pct >= 0 ? 'delta-up' : 'delta-down';
                delta = ` <span class="${cls}">${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</span>`;
              }
            }
            return `<td class="num">${fmtScore(score)}${delta}</td>`;
          })
          .join('');
        return `<tr><td>${escapeHtml(this.nameOf(id))}</td>${cells}</tr>`;
      })
      .join('');

    const overall = chosen
      .map((r, i) => {
        let delta = '';
        if (i > 0 && r.overall > 0 && chosen[0].overall > 0) {
          const pct =
            ((r.overall - chosen[0].overall) / chosen[0].overall) * 100;
          const cls = pct >= 0 ? 'delta-up' : 'delta-down';
          delta = ` <span class="${cls}">${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</span>`;
        }
        return `<td class="num">${fmtScore(r.overall)}${delta}</td>`;
      })
      .join('');

    host.innerHTML = `
      <table style="margin-top:14px">
        <thead><tr><th>Benchmark</th>${head}</tr></thead>
        <tbody>
          ${body}
          <tr class="overall"><td>Overall</td>${overall}</tr>
        </tbody>
      </table>`;
  }
}
