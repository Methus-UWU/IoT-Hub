import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve('dist/frontend/browser');
const mime: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

export default async function globalSetup(): Promise<() => Promise<void>> {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const requested = resolve(root, `.${pathname}`);
      const insideRoot = requested === root || requested.startsWith(`${root}${sep}`);
      let path = insideRoot ? requested : resolve(root, 'index.html');
      const info = insideRoot ? await stat(path).catch(() => null) : null;
      if (!info?.isFile()) path = resolve(root, 'index.html');
      response.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream' });
      response.end(await readFile(path));
    } catch {
      response.writeHead(500).end('E2E server error');
    }
  });

  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(4200, '127.0.0.1', resolveReady);
  });
  return () => new Promise<void>((resolveClosed, reject) => {
    server.close((error) => (error ? reject(error) : resolveClosed()));
  });
}
