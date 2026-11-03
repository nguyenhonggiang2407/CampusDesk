import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, RequestError, setCsrf } from '../src/api.js';

test('an unreadable response cannot become a successful guide save and keeps the HTTP status', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [200, 503]) {
      globalThis.fetch = async () => new Response('<html>unreadable response</html>', { status });
      await assert.rejects(
        () => api('/guides', { method: 'POST', body: '{}' }),
        (error: unknown) => error instanceof RequestError && error.status === status,
      );
    }
    globalThis.fetch = async () => new Response(null, { status: 204 });
    assert.equal(await api('/auth/logout', { method: 'POST', body: '{}' }), undefined);
  } finally {
    globalThis.fetch = original;
    setCsrf(null);
  }
});
