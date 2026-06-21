import esbuild from 'esbuild';
import {mkdir, cp, rm, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

const prod =
  process.env.NODE_ENV === 'production' || process.argv.includes('--prod');

// GitHub Pages serves the site from a subpath (/<repo>/). Set BASE_PATH in CI to
// rewrite asset URLs. Locally it stays "" so the dev server serves from root.
const basePath = process.env.BASE_PATH ?? '';

export async function buildOnce() {
  await rm(dist, {recursive: true, force: true});
  await mkdir(dist, {recursive: true});

  await esbuild.build({
    entryPoints: [resolve(root, 'src/main.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: prod,
    sourcemap: !prod,
    outfile: resolve(dist, 'main.js'),
    logLevel: 'info',
  });

  // index.html with base path rewritten in.
  let html = await readFile(resolve(root, 'src/index.html'), 'utf8');
  html = html.replaceAll('%BASE%', basePath);
  await writeFile(resolve(dist, 'index.html'), html);

  await cp(resolve(root, 'src/style.css'), resolve(dist, 'style.css'));

  return dist;
}

// esbuild context for watch mode (used by dev.mjs).
export async function createContext() {
  return esbuild.context({
    entryPoints: [resolve(root, 'src/main.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    sourcemap: true,
    outfile: resolve(dist, 'main.js'),
    logLevel: 'info',
  });
}

export {root, dist, basePath};

// Run directly: one-shot build.
if (import.meta.url === `file://${process.argv[1]}`) {
  await buildOnce();
  console.log(`Built to ${dist}`);
}
