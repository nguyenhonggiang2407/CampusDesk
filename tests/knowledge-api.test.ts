import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { normalizeSearch } from '../server/knowledge-store.js';
import type { AddressInfo } from 'node:net';
import type { KnowledgeGuide } from '../shared/knowledge.js';

const origin = 'http://127.0.0.1:5173';
async function fixture(t: TestContext) {
  const service = await createApp({ databasePath: ':memory:', seedDemo: true, origin });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    service.close();
  });
  class Client {
    cookie = '';
    csrf = '';
    async request(
      path: string,
      method = 'GET',
      body?: unknown,
      extra: Record<string, string> = {},
    ) {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: {
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: origin } : {}),
          ...extra,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const cookie = response.headers.get('set-cookie');
      if (cookie) this.cookie = cookie.split(';')[0];
      const value = response.status === 204 ? null : await response.json();
      return { status: response.status, value, response };
    }
    async login(email = 'staff@campus.example.test') {
      const result = await this.request('/auth/login', 'POST', {
        email,
        password: 'CampusDemo!2026',
      });
      assert.equal(result.status, 200);
      this.csrf = result.value.csrfToken;
      return this;
    }
  }
  return { ...service, client: () => new Client() };
}
const fields = {
  title: 'Đăng ký học bổng tại trường',
  summary: 'A fictional checklist for preparing a scholarship support request.',
  category: 'student_affairs',
  body: 'Prepare a clear explanation of the document you need. All information in this example is fictional; no private student records belong in the guide.',
};
const draft = () => ({ ...fields, requestId: randomUUID() });

test('knowledge routes require a session, including direct IDs, suggestions and activity', async (t) => {
  const f = await fixture(t),
    c = f.client(),
    id = randomUUID();
  for (const path of [
    '/guides',
    '/guides/suggestions?category=it',
    '/guides/' + id,
    '/guides/' + id + '/history',
  ])
    assert.equal((await c.request(path)).status, 401);
  assert.equal((await c.request('/guides', 'POST', draft())).status, 401);
  assert.equal((await c.request('/guides/' + id, 'PATCH', { ...fields, version: 1 })).status, 401);
  assert.equal(
    (await c.request('/guides/' + id + '/state', 'POST', { version: 1, state: 'published' }))
      .status,
    401,
  );
});
test('students only see published guides; drafts, archives, counts and editorial activity stay private', async (t) => {
  const f = await fixture(t),
    student = await f.client().login('student@campus.example.test'),
    staff = await f.client().login();
  const all = (await staff.request('/guides')).value;
  assert.equal(all.total, 4);
  const unpublished = all.guides.find((g: KnowledgeGuide) => g.state === 'draft');
  const publicPage = await student.request('/guides');
  assert.equal(publicPage.value.total, 3);
  assert(!JSON.stringify(publicPage.value).includes(unpublished.title));
  assert.equal((await student.request('/guides/' + unpublished.id)).status, 404);
  assert.equal((await student.request('/guides/' + unpublished.id + '/history')).status, 403);
  assert.equal((await student.request('/guides?state=draft')).status, 403);
  const item = publicPage.value.guides[0];
  assert.equal((await student.request('/guides/' + item.id)).value.body.length > 40, true);
  assert.equal((await student.request('/guides/' + item.id)).value.events, undefined);
  await staff.request('/guides/' + item.id + '/state', 'POST', {
    version: item.version,
    state: 'archived',
  });
  assert.equal((await student.request('/guides/' + item.id)).status, 404);
  assert.equal((await student.request('/guides')).value.total, 2);
});
test('student accounts cannot create, edit, publish or archive guides', async (t) => {
  const f = await fixture(t),
    student = await f.client().login('student@campus.example.test');
  const id = (await student.request('/guides')).value.guides[0].id;
  assert.equal((await student.request('/guides', 'POST', draft())).status, 403);
  assert.equal(
    (await student.request('/guides/' + id, 'PATCH', { ...fields, version: 1 })).status,
    403,
  );
  assert.equal(
    (await student.request('/guides/' + id + '/state', 'POST', { version: 1, state: 'draft' }))
      .status,
    403,
  );
  assert.equal((await student.request('/guides')).value.total, 3);
});
test('editorial writes enforce CSRF, exact Origin, JSON and validated schemas before changing data', async (t) => {
  const f = await fixture(t),
    staff = await f.client().login(),
    before = (await staff.request('/guides')).value.total;
  for (const token of ['', 'é'.repeat(64), 'a'.repeat(64)])
    assert.equal(
      (await staff.request('/guides', 'POST', draft(), { 'X-CSRF-Token': token })).status,
      403,
    );
  assert.equal(
    (await staff.request('/guides', 'POST', draft(), { Origin: 'https://foreign.example.test' }))
      .status,
    403,
  );
  assert.equal(
    (await staff.request('/guides', 'POST', draft(), { 'Content-Type': 'text/plain' })).status,
    415,
  );
  for (const extra of [
    { title: 'Tiny' },
    { summary: 'Short' },
    { body: 'Short' },
    { category: 'unlisted' },
    { state: 'published' },
    { requestId: 'invalid' },
    { title: 'A title\nwith a newline' },
    { body: 'A valid-looking guide body with a hidden\u0000 control character in it.' },
  ])
    assert.equal((await staff.request('/guides', 'POST', { ...draft(), ...extra })).status, 400);
  for (const suffix of ['unknown=1', 'page=0', 'page[]=2', 'category=invalid', 'state=unlisted'])
    assert.equal((await staff.request('/guides?' + suffix)).status, 400);
  assert.equal((await staff.request('/guides')).value.total, before);
});
test('a create request can be safely replayed without duplicate guides, events or state changes', async (t) => {
  const f = await fixture(t),
    staff = await f.client().login(),
    value = draft();
  const created = await staff.request('/guides', 'POST', value);
  assert.equal(created.status, 201);
  assert.equal(created.value.state, 'draft');
  const replay = await staff.request('/guides', 'POST', value);
  assert.equal(replay.status, 200);
  assert.equal(replay.value.id, created.value.id);
  const normalized = await staff.request('/guides', 'POST', {
    ...value,
    title: '  ' + value.title.normalize('NFD') + '  ',
    body: '  ' + value.body.replace(/\n/g, '\r\n') + '  ',
  });
  assert.equal(normalized.status, 200);
  assert.equal(normalized.value.id, created.value.id);
  assert.equal(
    (await staff.request('/guides', 'POST', { ...value, title: 'A different intended title' }))
      .status,
    409,
  );
  assert.equal((await staff.request('/guides')).value.total, 5);
  assert.equal(
    (await staff.request('/guides/' + created.value.id + '/history')).value.events.length,
    1,
  );
  const other = await f.client().login('jordan@campus.example.test');
  const otherCreate = await other.request('/guides', 'POST', value);
  assert.equal(otherCreate.status, 201);
  assert.notEqual(otherCreate.value.id, created.value.id);
});
test('Vietnamese search, literal symbols and edited search indexes work only on visible content', async (t) => {
  const f = await fixture(t),
    staff = await f.client().login(),
    student = await f.client().login('student@campus.example.test');
  const created = (await staff.request('/guides', 'POST', draft())).value;
  assert.equal((await student.request('/guides?search=dang%20ky')).value.total, 0);
  const published = (
    await staff.request('/guides/' + created.id + '/state', 'POST', {
      version: 1,
      state: 'published',
    })
  ).value;
  assert.equal(published.version, 2);
  const found = (await student.request('/guides?search=' + encodeURIComponent('dang KY hoc bong')))
    .value;
  assert.deepEqual(
    found.guides.map((g: KnowledgeGuide) => g.id),
    [created.id],
  );
  const changed = await staff.request('/guides/' + created.id, 'PATCH', {
    ...fields,
    title: 'Progress 100% for QA_1',
    summary: 'Literal special symbols help identify this fictional support guide.',
    body: 'Only this guide includes the literal path C:\\QA\\logs. <script>Literal source text is not HTML.</script>',
    version: 2,
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.value.version, 3);
  assert.equal(
    (await student.request('/guides?search=' + encodeURIComponent('học bổng'))).value.total,
    0,
  );
  for (const term of ['100%', 'QA_1', 'C:\\QA\\logs'])
    assert.deepEqual(
      (await student.request('/guides?search=' + encodeURIComponent(term))).value.guides.map(
        (g: KnowledgeGuide) => g.id,
      ),
      [created.id],
    );
  assert.equal((await student.request('/guides/' + created.id)).value.body, changed.value.body);
  assert.equal(normalizeSearch('ĐĂNG ký học bổng'), 'dang ky hoc bong');
});
test('competing staff edits accept one version and preserve the winner and its audit record', async (t) => {
  const f = await fixture(t),
    a = await f.client().login(),
    b = await f.client().login('jordan@campus.example.test');
  const guide = (await a.request('/guides', 'POST', draft())).value;
  const choices = await Promise.all([
    a.request('/guides/' + guide.id, 'PATCH', {
      ...fields,
      title: 'The first editorial choice',
      version: 1,
    }),
    b.request('/guides/' + guide.id, 'PATCH', {
      ...fields,
      title: 'The second editorial choice',
      version: 1,
    }),
  ]);
  assert.deepEqual(choices.map((r) => r.status).sort(), [200, 409]);
  const winner = choices.find((r) => r.status === 200)!.value;
  assert.equal((await a.request('/guides/' + guide.id)).value.title, winner.title);
  assert.equal((await a.request('/guides/' + guide.id)).value.version, 2);
  assert.equal((await a.request('/guides/' + guide.id + '/history')).value.events.length, 2);
});
test('publication, archive and restore use version checks and never republish an archived guide directly', async (t) => {
  const f = await fixture(t),
    staff = await f.client().login(),
    student = await f.client().login('student@campus.example.test');
  const created = (await staff.request('/guides', 'POST', draft())).value;
  const state = (value: string, version: number) =>
    staff.request('/guides/' + created.id + '/state', 'POST', { state: value, version });
  assert.equal((await state('published', 1)).status, 200);
  assert.equal((await student.request('/guides/' + created.id)).status, 200);
  assert.equal((await state('draft', 1)).status, 409);
  assert.equal((await state('draft', 2)).status, 200);
  assert.equal((await student.request('/guides/' + created.id)).status, 404);
  assert.equal((await state('archived', 3)).status, 200);
  assert.equal((await state('published', 4)).status, 409);
  assert.equal(
    (await staff.request('/guides/' + created.id, 'PATCH', { ...fields, version: 4 })).status,
    409,
  );
  assert.equal((await state('draft', 4)).status, 200);
  assert.equal((await state('published', 5)).status, 200);
  assert.equal(
    (await state('published', 6)).value.version,
    6,
    'repeating the same state is a no-op',
  );
  assert.equal((await staff.request('/guides/' + created.id + '/history')).value.events.length, 6);
});
test('suggestions rank relevant published guides while keeping service and publication boundaries', async (t) => {
  const f = await fixture(t),
    staff = await f.client().login(),
    student = await f.client().login('student@campus.example.test');
  const make = async (title: string, category = 'it') => {
    const value = (await staff.request('/guides', 'POST', { ...draft(), title, category })).value;
    await staff.request('/guides/' + value.id + '/state', 'POST', {
      version: 1,
      state: 'published',
    });
    return value.id;
  };
  const first = await make('Printer access on campus');
  await make('Printer supplies and paper', 'facilities');
  const hidden = (
    await staff.request('/guides', 'POST', {
      ...draft(),
      title: 'Printer hidden staff plan',
      category: 'it',
    })
  ).value;
  for (const client of [student, staff]) {
    const result = await client.request('/guides/suggestions?category=it&search=printer');
    assert.equal(result.status, 200);
    assert.equal(result.value.guides[0].id, first);
    assert(result.value.guides.length <= 3);
    assert(
      result.value.guides.every(
        (g: KnowledgeGuide) => g.category === 'it' && g.state === 'published',
      ),
    );
    assert(!JSON.stringify(result.value).includes(hidden.title));
  }
  assert.equal((await student.request('/guides/suggestions?category=it&unknown=1')).status, 400);
});
test('knowledge pagination returns every visible guide once and never counts unpublished rows for students', async (t) => {
  const f = await fixture(t),
    staff = await f.client().login(),
    student = await f.client().login('student@campus.example.test');
  for (let n = 0; n < 24; n++) {
    const value = (
      await staff.request('/guides', 'POST', {
        ...draft(),
        title: 'Fictional published checklist ' + n,
      })
    ).value;
    await staff.request('/guides/' + value.id + '/state', 'POST', {
      version: 1,
      state: 'published',
    });
  }
  const ids: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const result = await student.request('/guides?page=' + page);
    assert.equal(result.status, 200);
    assert.equal(result.value.total, 27);
    assert.equal(result.value.pages, 3);
    assert(result.value.guides.length <= 12);
    ids.push(...result.value.guides.map((g: KnowledgeGuide) => g.id));
  }
  assert.equal(ids.length, 27);
  assert.equal(new Set(ids).size, 27);
  assert.equal((await staff.request('/guides')).value.total, 28);
});
test('failed audit writes roll back guide creation, edit and publication as a unit', async (t) => {
  const f = await fixture(t),
    staff = await f.client().login(),
    before = (await staff.request('/guides')).value.total;
  f.db.exec(
    "CREATE TEMP TRIGGER fail_guide_audit BEFORE INSERT ON knowledge_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;",
  );
  assert.equal((await staff.request('/guides', 'POST', draft())).status, 500);
  assert.equal((await staff.request('/guides')).value.total, before);
  assert.equal(
    (f.db.prepare('SELECT count(*) n FROM knowledge_create_keys').get() as { n: number }).n,
    0,
  );
  f.db.exec('DROP TRIGGER fail_guide_audit');
  const guide = (await staff.request('/guides', 'POST', draft())).value;
  f.db.exec(
    "CREATE TEMP TRIGGER fail_guide_audit BEFORE INSERT ON knowledge_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END;",
  );
  assert.equal(
    (
      await staff.request('/guides/' + guide.id, 'PATCH', {
        ...fields,
        title: 'A change that must roll back',
        version: 1,
      })
    ).status,
    500,
  );
  assert.equal(
    (
      await staff.request('/guides/' + guide.id + '/state', 'POST', {
        version: 1,
        state: 'published',
      })
    ).status,
    500,
  );
  const unchanged = (await staff.request('/guides/' + guide.id)).value;
  assert.equal(unchanged.title, guide.title);
  assert.equal(unchanged.version, 1);
  assert.equal(unchanged.state, 'draft');
  assert.equal((await staff.request('/guides/' + guide.id + '/history')).value.events.length, 1);
});
test('a full library still accepts a safe create replay while refusing new guide intents', async (t) => {
  const f = await fixture(t),
    staff = await f.client().login(),
    value = draft();
  const guide = (await staff.request('/guides', 'POST', value)).value;
  const copy = f.db.prepare(
    'INSERT INTO knowledge_guides SELECT ?,title,summary,body,category,state,search_text,title_search,version,created_at,updated_at FROM knowledge_guides WHERE id=?',
  );
  f.db.exec('BEGIN');
  for (let n = 0; n < 495; n++) copy.run(randomUUID(), guide.id);
  f.db.exec('COMMIT');
  assert.equal((await staff.request('/guides')).value.total, 500);
  assert.equal((await staff.request('/guides', 'POST', value)).status, 200);
  assert.equal((await staff.request('/guides', 'POST', draft())).status, 409);
  assert.equal((await staff.request('/guides')).value.total, 500);
});
