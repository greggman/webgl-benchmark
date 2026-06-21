// Shared test harness: build, serve, and launch headless Chrome with WebGL.
import {buildOnce} from '../scripts/build.mjs';
import {serve} from '../scripts/serve.mjs';
import puppeteer from 'puppeteer';

// Flags that give headless Chrome a working WebGL2 even without a real GPU.
// SwiftShader validates the API path (correctness, not perf).
const GL_FLAGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--no-sandbox',
];

export async function launch({headless = true} = {}) {
  await buildOnce();
  const {server, url} = await serve();

  const browser = await puppeteer.launch({
    headless,
    args: GL_FLAGS,
    // The full suite under SwiftShader can take a while; don't let CDP time out.
    protocolTimeout: 600000,
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(String(err)));

  await page.goto(url, {waitUntil: 'load'});
  // Wait for the app to initialize WebGL and expose the test hook.
  await page.waitForFunction('window.__benchReady === true', {timeout: 20000});

  const stop = async () => {
    await browser.close();
    await new Promise(r => server.close(r));
  };

  return {browser, page, url, consoleErrors, stop};
}
