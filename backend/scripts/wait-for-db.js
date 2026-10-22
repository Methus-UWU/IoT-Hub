// Blocks until postgres-primary and postgres-replica accept TCP connections.
// Runs before `nest start --watch` so the app doesn't race container restarts
// where nestjs comes back up before the (separately-stacked) DB containers do.
const net = require('net');

const TARGETS = [
  { host: 'postgres-primary', port: 5432 },
  { host: 'postgres-replica', port: 5432 },
];
const RETRY_MS = 1000;
const TIMEOUT_MS = 3000;

function waitFor(host, port) {
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ host, port, timeout: TIMEOUT_MS });
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      const retry = () => {
        socket.destroy();
        setTimeout(attempt, RETRY_MS);
      };
      socket.once('error', retry);
      socket.once('timeout', retry);
    };
    attempt();
  });
}

async function main() {
  for (const { host, port } of TARGETS) {
    process.stdout.write(`[wait-for-db] waiting for ${host}:${port} ... `);
    const start = Date.now();
    await waitFor(host, port);
    console.log(`ok (${Date.now() - start}ms)`);
  }
}

main();
