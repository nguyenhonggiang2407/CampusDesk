import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const base = 'http://127.0.0.1:' + (process.env.PORT || 3001),
  stateFile = '/tmp/campusdesk-smoke-session.json';
let state = {};
async function call(path, method = 'GET', body) {
  const response = await fetch(base + '/api' + path, {
    method,
    signal: AbortSignal.timeout(5000),
    headers: {
      'Content-Type': 'application/json',
      Origin: process.env.APP_ORIGIN,
      ...(state.cookie ? { Cookie: state.cookie } : {}),
      ...(state.csrf ? { 'X-CSRF-Token': state.csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert(response.ok, `${method} ${path}: HTTP ${response.status}`);
  const cookie = response.headers.getSetCookie()[0];
  if (cookie) state.cookie = cookie.split(';')[0];
  return response.json();
}
if (process.argv[2] === 'seed') {
  const provision = spawnSync(process.execPath, ['dist/server/server/create-staff.js'], {
    env: {
      ...process.env,
      STAFF_NAME: 'Container Test',
      STAFF_EMAIL: 'container-test@example.test',
      STAFF_PASSWORD: 'Fictional-container-password-2030',
    },
    encoding: 'utf8',
  });
  assert.equal(provision.status, 0, 'Trusted staff provisioning failed');
  const session = await call('/auth/login', 'POST', {
    email: 'container-test@example.test',
    password: 'Fictional-container-password-2030',
  });
  state.csrf = session.csrfToken;
  const created = await call('/guides', 'POST', {
    requestId: randomUUID(),
    title: 'Container restart persistence guide',
    summary: 'A fictional guide used to verify the production container.',
    category: 'it',
    body: 'The guide, publication history and current account session must still exist after the container restarts.',
  });
  const published = await call('/guides/' + created.id + '/state', 'POST', {
    version: created.version,
    state: 'published',
  });
  state.id = published.id;
  state.version = published.version;
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
} else {
  state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const guide = await call('/guides/' + state.id);
  assert.equal(guide.title, 'Container restart persistence guide');
  assert.equal(guide.version, state.version);
  assert.equal(guide.state, 'published');
  assert.equal((await call('/guides/' + state.id + '/history')).events.length, 2);
  console.log('Knowledge content, publication history and session survived container restart.');
}
