import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from '../server/database.js';
import { createApp } from '../server/app.js';
import type { Session, TicketDetail, TicketPage } from '../shared/types.js';

const origin = 'http://127.0.0.1:5173';
async function fixture(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const service = await createApp({ databasePath: ':memory:', seedDemo: true, origin });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); service.close(); });
  class Client {
    cookie = ''; csrf = '';
    async request(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
      const headers: Record<string, string> = { ...(this.cookie ? { Cookie: this.cookie } : {}), ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...extra };
      const response = await fetch(`${base}/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const value = response.status === 204 ? null : await response.json();
      const cookie = response.headers.get('set-cookie'); if (cookie) this.cookie = cookie.split(';')[0];
      return { status: response.status, value, response };
    }
    async login(email = 'student@campus.example.test') {
      const result = await this.request('/auth/login', 'POST', { email, password: 'CampusDemo!2026' });
      assert.equal(result.status, 200); this.csrf = (result.value as Session).csrfToken!; return result.value as Session;
    }
  }
  return { ...service, client: () => new Client() };
}
const requestBody = { title: 'Library Wi-Fi problem', description: 'The north library network cannot connect after restarting my laptop.', category: 'it', priority: 'normal' };

test('students can submit, search and reply only to their own requests', async t => {
  const f = await fixture(t), student = f.client(), other = f.client(), anonymous = f.client();
  assert.equal((await anonymous.request('/tickets')).status, 401);
  await student.login(); await other.login('other@campus.example.test');
  const created = await student.request('/tickets', 'POST', { ...requestBody, priority: 'high' });
  assert.equal(created.status, 201); const ticket = created.value as TicketDetail;
  assert.equal(ticket.status, 'new'); assert.equal(ticket.version, 1); assert.equal(ticket.priority, 'high');
  assert.equal(ticket.dueDate, new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
  const listed = (await student.request('/tickets?search=Library%20Wi-Fi')).value as TicketPage;
  assert.deepEqual(listed.tickets.map(v => v.id), [ticket.id]);
  assert.equal((await other.request(`/tickets/${ticket.id}`)).status, 404);
  assert.equal((await other.request(`/tickets/${ticket.id}/comments`, 'POST', { body: 'Cannot view this.', visibility: 'public' })).status, 404);
  assert.equal((await student.request(`/tickets/${ticket.id}`, 'PATCH', { version: 1, status: 'closed' })).status, 403);
  assert.equal((await student.request('/staff')).status, 403);
  assert.equal((await student.request('/tickets?assigned=mine')).status, 403);
  assert.equal((await student.request('/tickets', 'POST', { ...requestBody, studentId: 4 })).status, 400);
  const reply = await student.request(`/tickets/${ticket.id}/comments`, 'POST', { body: '<script>literal text, never markup</script>' });
  assert.equal(reply.status, 201); assert.equal(reply.value.comments[0].body, '<script>literal text, never markup</script>');
  assert.equal((await student.request(`/tickets/${ticket.id}/comments`, 'POST', { body: 'Staff note?', visibility: 'private' })).status, 403);
  assert.equal((await student.request('/tickets?unknown=1')).status, 400);
});

test('internal notes are excluded from student detail, list and counts', async t => {
  const f = await fixture(t), staff = f.client(), student = f.client();
  await staff.login('staff@campus.example.test'); await student.login();
  const tickets = (await student.request('/tickets')).value as TicketPage;
  const ticket = tickets.tickets.find(v => v.title.includes('Projector'))!;
  const before = (await student.request(`/tickets/${ticket.id}`)).value as TicketDetail;
  assert.ok(before.comments.every(c => c.visibility === 'public'));
  const staffNote = await staff.request(`/tickets/${ticket.id}/comments`, 'POST', { body: 'Private workshop inventory detail', visibility: 'private' });
  assert.equal(staffNote.status, 201); assert.ok(staffNote.value.comments.some((c: { body: string }) => c.body === 'Private workshop inventory detail'));
  const after = (await student.request(`/tickets/${ticket.id}`)).value as TicketDetail;
  assert.equal(after.comments.length, before.comments.length); assert.equal(after.commentCount, before.commentCount);
  assert.ok(!JSON.stringify(after).includes('Private workshop inventory detail'));
  const listed = (await student.request('/tickets')).value as TicketPage;
  assert.equal(listed.tickets.find(v => v.id === ticket.id)!.commentCount, before.commentCount);
  assert.equal((await staff.request('/tickets', 'POST', requestBody)).status, 403);
});

test('staff triage enforces transitions, assignment, calendar validation and competing versions', async t => {
  const f = await fixture(t), student = f.client(), staff = f.client(), secondStaff = f.client();
  await student.login(); await staff.login('staff@campus.example.test'); await secondStaff.login('jordan@campus.example.test');
  const ticket = (await student.request('/tickets', 'POST', requestBody)).value as TicketDetail;
  const path = `/tickets/${ticket.id}`;
  assert.equal((await staff.request(path, 'PATCH', { version: 1, status: 'resolved' })).status, 409);
  assert.equal((await staff.request(path, 'PATCH', { version: 1, assignedTo: 1 })).status, 400);
  assert.equal((await staff.request(path, 'PATCH', { version: 1, dueDate: '2026-02-30' })).status, 400);
  const result = await staff.request(path, 'PATCH', { version: 1, status: 'triaged', assignedTo: 2, priority: 'high' });
  assert.equal(result.status, 200); assert.equal(result.value.version, 2); assert.equal(result.value.assignedName, 'Sam Rivera');
  assert.equal(result.value.events.length, 4);
  const competing = await Promise.all([staff.request(path, 'PATCH', { version: 2, status: 'in_progress' }), secondStaff.request(path, 'PATCH', { version: 2, priority: 'low' })]);
  assert.deepEqual(competing.map(v => v.status).sort(), [200, 409]);
  let latest = (await staff.request(path)).value as TicketDetail;
  if (latest.status === 'triaged') latest = (await staff.request(path, 'PATCH', { version: latest.version, status: 'in_progress' })).value;
  latest = (await staff.request(path, 'PATCH', { version: latest.version, status: 'resolved' })).value;
  latest = (await staff.request(path, 'PATCH', { version: latest.version, status: 'closed' })).value;
  assert.equal((await student.request(`${path}/comments`, 'POST', { body: 'More help please' })).status, 409);
  const reopened = await staff.request(path, 'PATCH', { version: latest.version, status: 'triaged', assignedTo: null });
  assert.equal(reopened.status, 200); assert.equal(reopened.value.assignedTo, null);
  assert.equal((await student.request(`${path}/comments`, 'POST', { body: 'More help please' })).status, 201);
});

test('CSRF and origin rejection stay controlled for malformed Unicode tokens, and logout revokes sessions', async t => {
  const f = await fixture(t), student = f.client(); await student.login();
  for (const token of ['', 'é'.repeat(64), '0'.repeat(64), 'a'.repeat(63)]) {
    assert.equal((await student.request('/tickets', 'POST', requestBody, { 'X-CSRF-Token': token })).status, 403);
  }
  assert.equal((await student.request('/tickets', 'POST', requestBody, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await student.request('/tickets', 'POST', requestBody, { 'Content-Type': 'text/plain' })).status, 415);
  const token = student.cookie.split('=')[1];
  assert.equal(f.db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(token), undefined);
  assert.equal((await student.request('/auth/logout', 'POST', {})).status, 204);
  assert.equal((await student.request('/tickets')).status, 401);
  assert.equal((await student.request('/session')).value.user, null);
});

test('registration always creates a student and handles parallel duplicate email without an internal error', async t => {
  const f = await fixture(t), a = f.client(), b = f.client();
  const input = { name: 'Fictional New Student', email: 'new@example.test', password: 'A fictional long password' };
  assert.equal((await a.request('/auth/register', 'POST', { ...input, role: 'staff' })).status, 400);
  const results = await Promise.all([a.request('/auth/register', 'POST', input), b.request('/auth/register', 'POST', { ...input, email: 'NEW@EXAMPLE.TEST' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const result = results.find(r => r.status === 201)!; assert.equal(result.value.user.role, 'student');
  assert.equal(result.value.user.email, input.email);
  const stored = f.db.prepare('SELECT password_hash FROM users WHERE email=?').get(input.email) as { password_hash: string };
  assert.ok(stored.password_hash.startsWith('scrypt:')); assert.ok(!stored.password_hash.includes(input.password));
});

test('throttles bound signup, bad login and shared demo sessions; expired limits can recover', async t => {
  const f = await fixture(t), client = f.client();
  for (let n = 0; n < 5; n++) assert.equal((await client.request('/auth/register', 'POST', { name: 'New Demo', email: `new${n}@example.test`, password: 'Long example password 2026' })).status, 201);
  assert.equal((await client.request('/auth/register', 'POST', { name: 'One More', email: 'overflow@example.test', password: 'Long example password 2026' })).status, 429);
  for (let n = 0; n < 5; n++) assert.equal((await client.request('/auth/login', 'POST', { email: 'missing@example.test', password: 'incorrect' })).status, 401);
  assert.equal((await client.request('/auth/login', 'POST', { email: 'missing@example.test', password: 'incorrect' })).status, 429);
  // Independent browsers use the same demo account; no unbounded session accumulation.
  for (let n = 0; n < 12; n++) await f.client().login();
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=1').get() as { n: number }).n, 10);
  f.db.prepare('UPDATE login_limits SET resets_at=0').run();
  assert.equal((await client.request('/auth/register', 'POST', { name: 'Recovered Demo', email: 'recovered@example.test', password: 'Long example password 2026' })).status, 201);
});

test('trusted staff provisioning creates a staff login and refuses to modify an existing account', t => {
  const path = resolve(`data/provision-test-${randomUUID()}.sqlite`);
  t.after(() => { for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) unlinkSync(path + suffix); });
  const env = { ...process.env, DATABASE_PATH: path, STAFF_NAME: 'Fictional Support Agent', STAFF_EMAIL: 'provisioned@example.test', STAFF_PASSWORD: 'Fictional provisioning password 2026' };
  const run = () => spawnSync(process.execPath, ['--import', 'tsx', 'server/create-staff.ts'], { env, encoding: 'utf8' });
  const first = run(); assert.equal(first.status, 0, first.stderr); assert.ok(!first.stdout.includes(env.STAFF_PASSWORD));
  const db = openDatabase(path);
  const user = db.prepare('SELECT role,password_hash FROM users WHERE email=?').get(env.STAFF_EMAIL) as { role: string; password_hash: string };
  assert.equal(user.role, 'staff'); assert.ok(user.password_hash.startsWith('scrypt:'));
  db.prepare("UPDATE users SET role='student' WHERE email=?").run(env.STAFF_EMAIL); db.close();
  const second = run(); assert.equal(second.status, 1); assert.ok(second.stderr.includes('already exists'));
  const after = openDatabase(path); assert.equal((after.prepare('SELECT role FROM users WHERE email=?').get(env.STAFF_EMAIL) as { role: string }).role, 'student'); after.close();
});
