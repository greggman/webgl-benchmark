import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize, resolve} from 'node:path';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getFreePort, commonHosts} from './get-free-port.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Serve files from `dir` (default dist/). Returns { server, port, url }.
export async function serve(dir = dist, startPort = 8080) {
  const root = resolve(dir);
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      let filePath = normalize(join(root, urlPath));
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      let s = await stat(filePath).catch(() => null);
      if (s?.isDirectory()) {
        filePath = join(filePath, 'index.html');
        s = await stat(filePath).catch(() => null);
      }
      if (!s) {
        res.writeHead(404).end('Not found');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });

  const port = await getFreePort(startPort, commonHosts);
  await new Promise(r => server.listen(port, r));
  const url = `http://localhost:${port}/`;
  return {server, port, url};
}

// Run directly: serve dist/ until killed.
if (import.meta.url === `file://${process.argv[1]}`) {
  const {url} = await serve();
  console.log(`Serving ${dist}\n  ${url}`);
}
