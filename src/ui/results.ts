import type {BenchResult, RunData} from '../bench/types.js';

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toFixed(0);
}

function fmtScore(n: number): string {
  return Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString() : '—';
}

function fmtTime(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function row(r: BenchResult): string {
  if (r.status === 'skipped') {
    return `<tr><td>${r.name}</td><td colspan="4" class="skip">skipped — ${r.reason ?? 'unsupported'}</td><td class="num">${fmtTime(r.durationMs)}</td></tr>`;
  }
  if (r.status === 'error') {
    return `<tr><td>${r.name}</td><td colspan="4" class="error">error — ${escapeHtml(r.reason ?? '')}</td><td class="num">${fmtTime(r.durationMs)}</td></tr>`;
  }
  const flagHtml =
    r.noise > 0.15
      ? `<span class="flag"> noisy ±${(r.noise * 100).toFixed(0)}%</span>`
      : '';
  const detail = `count ${fmtNum(r.count)} · ${fmtNum(r.frames)} frames · ${fmtNum(r.opsPerSec)} ops/s · ${r.cpuMsPerFrame.toFixed(3)} ms/frame · noise ±${(r.noise * 100).toFixed(0)}% · ${fmtTime(r.durationMs)} to test`;
  return `<tr>
    <td>${r.name}${flagHtml}</td>
    <td class="num">${fmtScore(r.score)}</td>
    <td class="num">${fmtNum(r.opsPerSec)}</td>
    <td class="num">${r.cpuMsPerFrame.toFixed(2)}</td>
    <td class="num">${fmtTime(r.durationMs)}</td>
    <td><details class="detail"><summary>details</summary><pre>${detail}</pre></details></td>
  </tr>`;
}

export function renderResults(container: HTMLElement, run: RunData): void {
  const rows = run.results.map(row).join('');
  container.innerHTML = `
    <div class="panel">
      <h2>Results — ${escapeHtml(run.label || 'unlabeled')}</h2>
      <table>
        <thead>
          <tr>
            <th>Benchmark</th>
            <th class="num">Score</th>
            <th class="num">ops/sec</th>
            <th class="num">ms/frame</th>
            <th class="num">time</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="overall">
            <td>Overall (geomean)</td>
            <td class="num">${fmtScore(run.overall)}</td>
            <td colspan="4"></td>
          </tr>
        </tbody>
      </table>
      <p class="progress">${escapeHtml(run.info.renderer)} · ${escapeHtml(run.info.version)}</p>
    </div>`;
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    c =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[
        c
      ]!,
  );
}
