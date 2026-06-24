import esbuild from 'esbuild';
import {mkdir, cp, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

const prod =
  process.env.NODE_ENV === 'production' || process.argv.includes('--prod');

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

  // Static assets are copied verbatim. All asset paths in index.html are
  // document-relative, so the site works from any URL depth (incl. the GitHub
  // Pages /<repo>/ subpath) with no base-path rewriting.
  await cp(resolve(root, 'src/index.html'), resolve(dist, 'index.html'));
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

export {root, dist};

// Run directly: one-shot build.
if (import.meta.url === `file://${process.argv[1]}`) {
  await buildOnce();
  console.log(`Built to ${dist}`);
}
