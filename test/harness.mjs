// Shared test harness: build, serve, and launch headless Chrome with WebGL.
import {buildOnce} from '../scripts/build.mjs';
import {serve} from '../scripts/serve.mjs';
import puppeteer from 'puppeteer';

// Use the real GPU. Headless Chrome renders WebGL on the host GPU (macOS CI runners
// and dev machines have one); we deliberately do NOT fall back to SwiftShader, which
// is deprecated in Chrome (it now requires --enable-unsafe-swiftshader) and is so
// slow per frame that the drain-between-frames runner times out under it.
const GL_FLAGS = ['--ignore-gpu-blocklist', '--no-sandbox'];

export async function launch({headless = true} = {}) {
  await buildOnce();
  const {server, url} = await serve();

  const browser = await puppeteer.launch({
    headless,
    args: GL_FLAGS,
    protocolTimeout: 120000,
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
