// Regenerate src/ui/baseline.json by running the full suite on THIS machine.
// Uses the real GPU when available (no SwiftShader), since baseline perf should
// reflect real hardware. Run: `npm run baseline` then `npm run build`.
import {buildOnce} from '../scripts/build.mjs';
import {serve} from '../scripts/serve.mjs';
import puppeteer from 'puppeteer';
import {writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'src/ui/baseline.json');

await buildOnce();
const {server, url} = await serve();

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.goto(url, {waitUntil: 'load'});
  await page.waitForFunction('window.__benchReady === true', {timeout: 20000});

  console.log('Running full suite for baseline (this takes a bit)…');
  const run = await page.evaluate(() => window.__runFull());
  if (!run) throw new Error('baseline run produced no result');

  const baseline = {};
  for (const r of run.results) {
    if (r.status === 'ok' && r.opsPerSec > 0) {
      baseline[r.id] = Math.round(r.opsPerSec);
    }
  }

  await writeFile(outPath, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(baseline).length} baselines to ${outPath}`);
  console.log(`Renderer: ${run.info.renderer}`);
  console.log('Now run `npm run build` to bundle the new baseline.');
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
