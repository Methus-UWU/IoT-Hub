/** Run over stdin inside the API container; never print its environment. */
import assert from 'node:assert/strict';
import { access, constants } from 'node:fs/promises';
import pg from 'pg';

const base = process.env.VERIFY_BASE_URL ?? 'http://unity-hub-nginx';
const origin = 'https://unity-hub.connectdb.xyz';
const request = (path) => fetch(new URL(path, base), {
  headers: { Origin: origin },
  signal: AbortSignal.timeout(10000),
});

try {
  assert.equal(process.env.NODE_ENV, 'production');
  assert.notEqual(process.getuid(), 0);
  for (const path of ['/app/.env', '/app/src', '/app/node_modules/@nestjs/cli']) {
    await assert.rejects(access(path), `${path} must not be in the runtime image`);
  }
  await access(process.env.WORKSPACE_ROOT, constants.W_OK);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    const result = await pool.query('SELECT 1 AS ready');
    assert.equal(result.rows[0].ready, 1);
  } finally {
    await pool.end();
  }
  console.log('PASS: production runtime, non-root user, runtime contents, workspace access, database connection');

  const home = await request('/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('cache-control'), /no-store/);
  const html = await home.text();
  assert.match(html, /<app-root/);
  const script = html.match(/src="([^"]+\.js)"/);
  assert.ok(script, 'built Angular entry script must exist');
  const asset = await request(script[1]);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.match(asset.headers.get('content-type'), /javascript/);

  const deepLink = await request('/docs');
  assert.equal(deepLink.status, 200);
  assert.match(await deepLink.text(), /<app-root/);
  for (const path of ['/missing-12345678.js', '/.env', '/main.js.map']) {
    assert.equal((await request(path)).status, 404, `${path} must return 404`);
  }
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), origin);
  assert.deepEqual(await health.json(), { data: { status: 'ok' } });
  assert.equal((await request('/api/auth/me')).status, 401);
  console.log('PASS: SPA deep links, hashed assets, cache policy, missing files, API proxy, CORS, protected route');
} catch {
  // Driver errors may include database details. Keep this operator output safe.
  console.error('Production verification failed; inspect the failing check locally without sharing credentials.');
  process.exitCode = 1;
}
