import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import { runtimeConfig } from '../server/config.js';
import { seedDemoLogin } from '../server/database.js';

const origin = 'http://127.0.0.1:5173';
const email = 'portfolio-fixture@example.test';
const password = 'Fixture-10';

async function serve(t: TestContext, options: Parameters<typeof createApp>[0]) {
  const { app, db, close } = await createApp(options);
  const server = app.listen(0, '127.0.0.1');
  const stop = async () => {
    if (!server.listening) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    close();
  };
  t.after(stop);
  await once(server, 'listening');
  return { db, stop, address: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
}

test('configured demo login requires explicit opt-in and a separate database setting', () => {
  assert.equal(
    runtimeConfig({ DEMO_LOGIN_EMAIL: email, DEMO_LOGIN_PASSWORD: password }).demoLogin,
    undefined,
  );
  assert.throws(() => runtimeConfig({ DEMO_LOGIN_ENABLED: '1' }), /explicit demo DATABASE_PATH/);
  assert.throws(
    () => runtimeConfig({ DEMO_LOGIN_ENABLED: '1', DATABASE_PATH: ':memory:', DEMO_SEED: '0' }),
    /Set valid DEMO_LOGIN_EMAIL and DEMO_LOGIN_PASSWORD/,
  );
  assert.throws(
    () => runtimeConfig({ DEMO_LOGIN_ENABLED: '1', DATABASE_PATH: ':memory:', DEMO_SEED: '1' }),
    /DEMO_SEED=0/,
  );
});

test('the configured account has one fictional student ticket and keeps its password and data on reseed', async (t) => {
  const config = runtimeConfig({
    DEMO_LOGIN_ENABLED: '1',
    DEMO_LOGIN_EMAIL: email.toUpperCase(),
    DEMO_LOGIN_PASSWORD: password,
    DATABASE_PATH: ':memory:',
    DEMO_SEED: '0',
  });
  const { db, address } = await serve(t, config);
  await seedDemoLogin(db, { email, password: 'A different fictional password' });
  db.prepare(
    "INSERT INTO users(name,email,password_hash,role) VALUES('Fictional Staff',?,'test-only','staff')",
  ).run('staff@example.test');
  await assert.rejects(
    seedDemoLogin(db, { email: 'staff@example.test', password }),
    /staff account/,
  );
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tickets').get() as { n: number }).n, 1);
  const user = db.prepare('SELECT password_hash,role FROM users WHERE email=?').get(email)!;
  assert.match(String(user.password_hash), /^scrypt:/);
  assert.equal(user.role, 'student');
  assert.equal((await fetch(address + '/api/tickets')).status, 401);
  const login = (value: string) =>
    fetch(address + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email, password: value }),
    });
  assert.equal((await login('A different fictional password')).status, 401);
  const reply = await login(password);
  assert.equal(reply.status, 200);
  const cookie = reply.headers.get('set-cookie')!.split(';')[0];
  const session = await reply.json();
  const tickets = await fetch(address + '/api/tickets', { headers: { Cookie: cookie } });
  assert.equal((await tickets.json()).tickets.length, 1);
  assert.equal((await fetch(address + '/api/staff', { headers: { Cookie: cookie } })).status, 403);
  const logout = await fetch(address + '/api/auth/logout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
      Cookie: cookie,
      'X-CSRF-Token': session.csrfToken,
    },
    body: '{}',
  });
  assert.equal(logout.status, 204);
  assert.equal(
    (await fetch(address + '/api/tickets', { headers: { Cookie: cookie } })).status,
    401,
  );
});

test('disabling demo login revokes its cookies and keeps a pre-migration student account and session', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'campus-demo-login-'));
  let running: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    const databasePath = join(dir, 'campus.sqlite');
    const env = { DATABASE_PATH: databasePath, APP_ORIGIN: origin, DEMO_SEED: '0' };
    const disabledConfig = runtimeConfig(env);
    const enabledConfig = runtimeConfig({
      ...env,
      DEMO_LOGIN_ENABLED: '1',
      DEMO_LOGIN_EMAIL: email,
      DEMO_LOGIN_PASSWORD: password,
    });
    const ordinary = { email: 'regular-student@example.test', password: 'Student-Only-12' };
    function post(address: string, path: string, data: Record<string, string>) {
      return fetch(address + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify(data),
      });
    }
    function session(address: string, cookie: string) {
      return fetch(address + '/api/tickets', { headers: { Cookie: cookie } });
    }

    const old = (running = await serve(t, disabledConfig));
    const registration = await post(old.address, '/api/auth/register', {
      ...ordinary,
      name: 'Regular Student',
    });
    assert.equal(registration.status, 201);
    const ordinaryCookie = registration.headers.get('set-cookie')!.split(';')[0];
    const original = old.db.prepare('SELECT * FROM users WHERE email=?').get(ordinary.email);
    old.db.exec('DROP TABLE demo_login_accounts; PRAGMA user_version=2;');
    await old.stop();

    await assert.rejects(
      createApp({ ...enabledConfig, demoLogin: { email: ordinary.email, password } }),
      /existing student account/,
    );
    const enabled = (running = await serve(t, enabledConfig));
    assert.deepEqual(
      enabled.db.prepare('SELECT * FROM users WHERE email=?').get(ordinary.email),
      original,
    );
    assert.equal((await session(enabled.address, ordinaryCookie)).status, 200);
    const demo = await post(enabled.address, '/api/auth/login', { email, password });
    assert.equal(demo.status, 200);
    const demoCookie = demo.headers.get('set-cookie')!.split(';')[0];
    await enabled.stop();

    const disabled = (running = await serve(t, disabledConfig));
    assert.equal(
      (await post(disabled.address, '/api/auth/login', { email, password })).status,
      401,
    );
    assert.equal((await session(disabled.address, demoCookie)).status, 401);
    assert.equal((await session(disabled.address, ordinaryCookie)).status, 200);
    assert.equal((await post(disabled.address, '/api/auth/login', ordinary)).status, 200);
    await disabled.stop();

    const reenabled = (running = await serve(t, enabledConfig));
    assert.equal((await session(reenabled.address, demoCookie)).status, 401);
    assert.equal(
      (await post(reenabled.address, '/api/auth/login', { email, password })).status,
      200,
    );
  } finally {
    await running?.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
