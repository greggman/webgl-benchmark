import {createContext} from './build.mjs';
import {serve} from './serve.mjs';
import {mkdir, cp, watch} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

await mkdir(dist, {recursive: true});

// Copy static assets (html/css) into dist verbatim — asset paths are relative.
async function copyStatic() {
  await cp(resolve(root, 'src/index.html'), resolve(dist, 'index.html'));
  await cp(resolve(root, 'src/style.css'), resolve(dist, 'style.css'));
}

await copyStatic();

const ctx = await createContext();
await ctx.watch();

// Re-copy static assets when they change.
(async () => {
  const watcher = watch(resolve(root, 'src'), {recursive: true});
  for await (const ev of watcher) {
    if (ev.filename && /\.(html|css)$/.test(ev.filename)) {
      await copyStatic().catch(() => {});
    }
  }
})();

const {url} = await serve(dist);
console.log(
  `\n  Dev server: ${url}\n  (esbuild watching src/, ctrl-c to stop)\n`,
);
