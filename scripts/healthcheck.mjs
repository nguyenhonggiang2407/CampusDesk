import assert from 'node:assert/strict';
const port = Number(process.env.PORT ?? 3001);
assert(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid PORT');
const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
  signal: AbortSignal.timeout(3000),
});
assert(response.ok, 'Health status');
assert.equal((await response.json()).status, 'ok');
