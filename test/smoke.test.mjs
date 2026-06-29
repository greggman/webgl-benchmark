import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {launch} from './harness.mjs';

let h;

before(async () => {
  h = await launch();
});

after(async () => {
  await h?.stop();
});

test('app initializes a WebGL2 context', async () => {
  const renderer = await h.page.evaluate(() => {
    const c = document.getElementById('gl');
    const gl = c.getContext('webgl2');
    return gl ? String(gl.getParameter(gl.VERSION)) : null;
  });
  assert.ok(renderer, 'expected a WebGL2 context');
  assert.match(renderer, /WebGL 2/i);
});

test('every benchmark runs in fast mode and produces a sane result', async () => {
  const run = await h.page.evaluate(() => window.__runQuick());
  assert.ok(run, 'expected a run result');
  assert.ok(
    Array.isArray(run.results) && run.results.length >= 18,
    'expected ~21 results',
  );

  for (const r of run.results) {
    if (r.status === 'skipped') continue; // missing extension (e.g. multi_draw) is fine
    assert.equal(
      r.status,
      'ok',
      `${r.id} should be ok, got ${r.status}: ${r.reason ?? ''}`,
    );
    assert.ok(
      Number.isFinite(r.opsPerSec) && r.opsPerSec > 0,
      `${r.id} ops/sec should be positive`,
    );
    assert.ok(
      Number.isFinite(r.score) && r.score > 0,
      `${r.id} score should be positive`,
    );
    assert.ok(r.count > 0, `${r.id} calibrated count should be positive`);
  }

  // Overall is the geomean of the OK benches; must be a positive number.
  assert.ok(
    Number.isFinite(run.overall) && run.overall > 0,
    'overall score should be positive',
  );
});

test('no uncaught console / page errors during the run', () => {
  // WebGL warnings sometimes log; only fail on hard errors we recognize.
  const fatal = h.consoleErrors.filter(t =>
    /Error|exception|undefined is not/i.test(t),
  );
  assert.deepEqual(fatal, [], `unexpected errors:\n${fatal.join('\n')}`);
});
