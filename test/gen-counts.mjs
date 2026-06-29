// Regenerate src/bench/defaultCounts.json — the per-benchmark op counts bundled into
// the page so every run (and every browser build) does identical work. Calibrates a
// few times on THIS machine and takes the median count per benchmark.
//
// Run: `npm run counts` then `npm run build` to bundle the new counts.
import {buildOnce} from '../scripts/build.mjs';
import {serve} from '../scripts/serve.mjs';
import puppeteer from 'puppeteer';
import {writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'src/bench/defaultCounts.json');
const ROUNDS = 3;

await buildOnce();
const {server, url} = await serve();
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox'],
  protocolTimeout: 600000,
});

try {
  const page = await browser.newPage();
  await page.goto(url, {waitUntil: 'load'});
  await page.waitForFunction('window.__benchReady === true', {timeout: 20000});

  console.log(`Calibrating ${ROUNDS}× to pick stable counts…`);
  const samples = {};
  for (let r = 0; r < ROUNDS; r++) {
    // Click "Recalibrate" so the run picks counts fresh instead of using the bundled
    // ones, then run the full suite and collect each bench's calibrated count.
    await page.evaluate(() => document.querySelector('#recal')?.click());
    const run = await page.evaluate(() => window.__runFull());
    for (const x of run.results) {
      if (x.status === 'ok') (samples[x.id] ??= []).push(x.count);
    }
  }

  const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];
  const counts = {};
  for (const [id, a] of Object.entries(samples)) counts[id] = median(a);

  await writeFile(outPath, JSON.stringify(counts, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(counts).length} counts to ${outPath}`);
  console.log('Now run `npm run build` to bundle them.');
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
