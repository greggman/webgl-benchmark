import {createGLEnv, WebGL2RequiredError} from './gl/context.js';
import {App, FAST_CONFIG} from './ui/app.js';
import {createAllBenchmarks} from './bench/registry.js';
import type {RunData} from './bench/types.js';

declare global {
  interface Window {
    // Test hook: run every supported benchmark in fast mode, resolve with the run.
    __runQuick?: () => Promise<RunData | null>;
    // Baseline hook: run every supported benchmark at full settings.
    __runFull?: () => Promise<RunData | null>;
    __benchReady?: boolean;
  }
}

function fail(message: string): void {
  const app = document.getElementById('app');
  if (app) app.innerHTML = `<div class="panel error">${message}</div>`;
}

function main(): void {
  const canvas = document.getElementById('gl') as HTMLCanvasElement | null;
  const root = document.getElementById('app');
  if (!canvas || !root) return;

  // Handle context loss so a lost device shows a message instead of NaNs.
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    fail('The WebGL context was lost. Reload the page to try again.');
  });

  let env;
  try {
    env = createGLEnv(canvas);
  } catch (err) {
    if (err instanceof WebGL2RequiredError) {
      fail(
        'This benchmark requires <strong>WebGL2</strong>, which this browser/device did not provide. ' +
          'Try a recent Chrome, Edge, Firefox, or Safari.',
      );
    } else {
      fail(`Could not initialize WebGL: ${String(err)}`);
    }
    return;
  }

  const app = new App(env, root);

  const supportedIds = () =>
    createAllBenchmarks()
      .filter(
        b =>
          !b.supported ||
          b.supported({gl: env.gl, canvas, env, has: n => env.has(n)}),
      )
      .map(b => b.id);

  // Expose a fast run for the Puppeteer smoke test, and a full run for baselines.
  window.__runQuick = async () =>
    app.run(supportedIds(), 'quick-test', FAST_CONFIG);
  window.__runFull = async () => app.run(supportedIds(), 'baseline');
  window.__benchReady = true;
}

main();
