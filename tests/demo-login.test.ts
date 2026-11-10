import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../server/app.js';
import { runtimeConfig } from '../server/config.js';
import { seedDemoLogin } from '../server/database.js';

const origin = 'http://127.0.0.1:5173';
const email = 'portfolio-fixture@example.test';
const password = 'Fixture-10';

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
  const { app, db, close } = await createApp(config);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    close();
  });
  await once(server, 'listening');
  const address = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  await seedDemoLogin(db, config.demoLogin!);
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
