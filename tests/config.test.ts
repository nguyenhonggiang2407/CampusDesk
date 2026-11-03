import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig } from '../server/config.js';

test('production requires a valid HTTPS origin, secure cookies and explicit demo seeding', () => {
  const live = runtimeConfig({
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://support.example.test',
    COOKIE_SECURE: '0',
  });
  assert.equal(live.secureCookies, true);
  assert.equal(live.seedDemo, false);
  assert.equal(
    runtimeConfig({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://support.example.test',
      DEMO_SEED: '1',
    }).seedDemo,
    true,
  );
  for (const origin of [
    'http://support.example.test',
    'https://support.example.test/',
    'https://support.example.test/path',
    'https://name:password@support.example.test',
    'file:///tmp/preview',
  ])
    assert.throws(() => runtimeConfig({ NODE_ENV: 'production', APP_ORIGIN: origin }));
  for (const port of ['0', '65536', 'abc', '1.5'])
    assert.throws(() => runtimeConfig({ PORT: port }));
  assert.throws(() => runtimeConfig({ DATABASE_PATH: '' }));
  const local = runtimeConfig({});
  assert.equal(local.host, '127.0.0.1');
  assert.equal(local.secureCookies, false);
  assert.equal(local.seedDemo, true);
});
