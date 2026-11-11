import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createApp } from '../dist/server/server/app.js';
let server, service, browser, base;
before(async () => {
  mkdirSync('docs/screenshots', { recursive: true });
  server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = 'http://127.0.0.1:' + server.address().port;
  service = await createApp({
    databasePath: ':memory:',
    seedDemo: true,
    origin: base,
    serveClient: true,
  });
  server.on('request', service.app);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
});
after(async () => {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
  service?.close();
});
async function fixture(t, role = 'staff', options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  await context.route('https://fonts.googleapis.com/**', (route) => route.abort());
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, []);
  });
  const email =
    role === 'otherstaff' ? 'jordan@campus.example.test' : role + '@campus.example.test';
  const response = await context.request.post(base + '/api/auth/login', {
    data: { email, password: 'CampusDemo!2026' },
    headers: { Origin: base },
  });
  assert.equal(response.status(), 200);
  const session = await response.json();
  return {
    context,
    page,
    user: session.user,
    headers: { Origin: base, 'X-CSRF-Token': session.csrfToken },
  };
}
const fields = {
  title: 'Library printer access',
  summary: 'A clear checklist for setting up a library printing request.',
  category: 'it',
  body: 'Check the printer label and the room number before you begin. This is a fictional support guide. If printing still fails, send an IT support request with the error message. Never share passwords in the request.',
};
async function create(f, input = {}) {
  const response = await f.context.request.post(base + '/api/guides', {
    headers: f.headers,
    data: { ...fields, ...input, requestId: randomUUID() },
  });
  assert.equal(response.status(), 201);
  return response.json();
}
async function publish(f, guide) {
  const response = await f.context.request.post(base + '/api/guides/' + guide.id + '/state', {
    headers: f.headers,
    data: { version: guide.version, state: 'published' },
  });
  assert.equal(response.status(), 200);
  return response.json();
}
async function library(f) {
  await f.page.goto(base);
  await f.page.getByRole('button', { name: 'Knowledge library', exact: true }).click();
  await expect(
    f.page.getByRole('heading', { name: 'Answers for campus life.', exact: true }),
  ).toBeVisible();
}
async function open(f, title) {
  await library(f);
  await f.page.getByLabel('Search guides').fill(title);
  await f.page.getByRole('button', { name: 'Open guide: ' + title, exact: true }).click();
  await expect(f.page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}
async function fill(f, input = fields) {
  await f.page.getByLabel('Guide title', { exact: true }).fill(input.title);
  await f.page.getByLabel('Guide service area', { exact: true }).selectOption(input.category);
  await f.page.getByRole('textbox', { name: /^Short summary/ }).fill(input.summary);
  await f.page.getByRole('textbox', { name: /^Guide content/ }).fill(input.body);
}
async function capture(page, name) {
  await page.locator('#workspace-content').focus();
  await page.locator('#workspace-content').evaluate((element) => element.blur());
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshots/' + name + '.png', fullPage: true });
}
for (const { name, width, height, role, workspace } of [
  { name: 'desktop', width: 1440, height: 900, role: 'Staff demo', workspace: /^Service queue/ },
  { name: 'mobile', width: 390, height: 844, role: 'Student demo', workspace: /^My requests/ },
]) {
  test(`sign-in shows the local classroom photo and opens the ${name} demo`, async (t) => {
    const context = await browser.newContext({ viewport: { width, height } });
    t.after(() => context.close());
    await context.route('**/*', (route) =>
      route
        .request()
        .url()
        .startsWith(base + '/')
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const photoResponse = page.waitForResponse(
      (res) => res.url() === base + '/campus-classroom.webp',
    );
    await page.goto(base);
    const enterWorkspace = page.getByRole('button', { name: 'Enter workspace' });
    await expect(enterWorkspace).toBeInViewport({ ratio: 1 });
    const image = page.getByRole('img', { name: /empty university classroom/i });
    if (name === 'mobile') {
      const action = await enterWorkspace.boundingBox();
      const photo = await image.boundingBox();
      assert.ok(action && photo && action.y + action.height < photo.y);
    }
    await image.scrollIntoViewIfNeeded();
    await expect(image).toBeVisible();
    await image.evaluate((element) => element.decode());
    assert.match((await photoResponse).headers()['content-type'], /image\/webp/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: `docs/screenshots/sign-in-${name}.jpg`,
      fullPage: true,
      quality: 86,
    });
    const selector = page.getByRole('button', { name: role, exact: true });
    await selector.press('Enter');
    await expect(selector).toHaveAttribute('aria-pressed', 'true');
    await enterWorkspace.click();
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('button', { name: workspace })).toBeVisible();
  });
}
test(
  'staff publish a guide that students can read while source-like text remains literal',
  { timeout: 45000 },
  async (t) => {
    const staff = await fixture(t),
      student = await fixture(t, 'student');
    await library(staff);
    await staff.page.getByRole('button', { name: 'New guide', exact: true }).click();
    const text = {
      ...fields,
      body: fields.body + '\n\nExample text: <script>window.guideScriptRan=true</script>',
    };
    await fill(staff, text);
    await staff.page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(staff.page.locator('.knowledge-editorial .knowledge-state')).toHaveText('draft');
    await library(student);
    await student.page.getByLabel('Search guides').fill(fields.title);
    await expect(student.page.locator('.knowledge-empty')).toBeVisible();
    await expect(student.page.getByRole('button', { name: 'New guide', exact: true })).toHaveCount(
      0,
    );
    await staff.page.getByRole('button', { name: 'Publish guide', exact: true }).click();
    await expect(staff.page.locator('.knowledge-editorial .knowledge-state')).toHaveText(
      'published',
    );
    await student.page.getByRole('button', { name: 'Refresh guides', exact: true }).click();
    await student.page
      .getByRole('button', { name: 'Open guide: ' + fields.title, exact: true })
      .click();
    await expect(student.page.locator('.knowledge-body')).toHaveText(text.body);
    assert.equal(await student.page.evaluate(() => window.guideScriptRan), undefined);
    await expect(student.page.locator('.knowledge-body script')).toHaveCount(0);
    await expect(student.page.getByRole('button', { name: 'Edit guide', exact: true })).toHaveCount(
      0,
    );
    await library(student);
    await expect(student.page.locator('.knowledge-card').first()).toBeVisible();
    await capture(student.page, 'knowledge-desktop');
  },
);
test(
  'a stale editorial form keeps its draft and compares the current saved version',
  { timeout: 45000 },
  async (t) => {
    const a = await fixture(t),
      b = await fixture(t, 'otherstaff');
    const guide = await create(a, { title: 'Competing staff guide' });
    await open(a, guide.title);
    await a.page.getByRole('button', { name: 'Edit guide', exact: true }).click();
    await a.page.getByLabel('Guide title', { exact: true }).fill('My unsaved editorial choice');
    const response = await b.context.request.patch(base + '/api/guides/' + guide.id, {
      headers: b.headers,
      data: { ...fields, title: 'A newer shared editorial choice', version: 1 },
    });
    assert.equal(response.status(), 200);
    await a.page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(a.page.getByRole('alert')).toContainText('changed elsewhere');
    await expect(a.page.getByLabel('Guide title', { exact: true })).toHaveValue(
      'My unsaved editorial choice',
    );
    await a.page.getByRole('button', { name: 'Compare current version', exact: true }).click();
    await expect(a.page.getByRole('region', { name: 'Current saved version' })).toContainText(
      'A newer shared editorial choice',
    );
    await expect(a.page.getByLabel('Guide title', { exact: true })).toHaveValue(
      'My unsaved editorial choice',
    );
    await a.page
      .getByRole('button', { name: 'Replace form with current version', exact: true })
      .click();
    await expect(a.page.getByLabel('Guide title', { exact: true })).toHaveValue(
      'A newer shared editorial choice',
    );
    await a.page
      .getByRole('textbox', { name: /^Short summary/ })
      .fill('The two staff members reviewed this fictional guide together.');
    await a.page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(a.page.locator('.knowledge-article-heading small')).toContainText('Version 3');
  },
);
test(
  'a lost create response can be retried once without duplicate guides or activity',
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t),
      input = { ...fields, title: 'A reliable draft after a lost response' };
    await library(f);
    await f.page.getByRole('button', { name: 'New guide', exact: true }).click();
    await fill(f, input);
    await capture(f.page, 'guide-editor-desktop');
    let first = true,
      release,
      reached;
    const gate = new Promise((done) => {
        release = done;
      }),
      started = new Promise((done) => {
        reached = done;
      }),
      keys = [];
    await f.page.route('**/api/guides', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      keys.push(route.request().postDataJSON().requestId);
      if (!first) return route.continue();
      first = false;
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      reached();
      await gate;
      await route.abort('failed');
    });
    try {
      await f.page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await started;
      await expect(f.page.getByLabel('Guide title', { exact: true })).toBeDisabled();
      await expect(f.page.getByRole('textbox', { name: /^Guide content/ })).toBeDisabled();
      await expect(f.page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    } finally {
      release();
    }
    await expect(f.page.getByRole('alert')).toBeVisible();
    await expect(f.page.getByLabel('Guide title', { exact: true })).toHaveValue(input.title);
    await expect(f.page.getByLabel('Guide title', { exact: true })).toBeEnabled();
    await f.page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(f.page.getByRole('heading', { name: input.title, exact: true })).toBeVisible();
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    const rows = service.db
      .prepare('SELECT id,version FROM knowledge_guides WHERE title=?')
      .all(input.title);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].version, 1);
    assert.equal(
      service.db.prepare('SELECT count(*) n FROM knowledge_events WHERE guide_id=?').get(rows[0].id)
        .n,
      1,
    );
  },
);
test(
  'late suggestions cannot replace a new service area or alter a pending support request',
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t, 'student');
    await f.page.goto(base);
    await f.page.getByRole('button', { name: 'New request', exact: true }).click();
    const dialog = f.page.getByRole('dialog', { name: 'Create a support request', exact: true });
    await dialog.getByLabel('Service area', { exact: true }).selectOption('it');
    await dialog.getByLabel('Short title', { exact: true }).fill('Wi-Fi and projector connection');
    const description =
      'The fictional seminar room needs help with the projector connection. Please keep these original details.';
    await dialog.getByRole('textbox', { name: /^Tell us a little more/ }).fill(description);
    await dialog
      .locator('.related-guides summary')
      .filter({ hasText: 'Connecting to campus Wi-Fi' })
      .click();
    await expect(dialog.locator('.related-guides')).toContainText('Never include your password');
    let release, reached, finished;
    const gate = new Promise((done) => {
        release = done;
      }),
      started = new Promise((done) => {
        reached = done;
      }),
      ended = new Promise((done) => {
        finished = done;
      });
    await f.page.route('**/api/guides/suggestions?**', async (route) => {
      const url = new URL(route.request().url());
      if (
        url.searchParams.get('category') !== 'it' ||
        !url.searchParams.get('search')?.includes('blocked')
      )
        return route.continue();
      const response = await route.fetch();
      reached();
      await gate;
      try {
        await route.fulfill({ response });
      } catch {
        /* A changed service area aborts the obsolete response. */
      } finally {
        finished();
      }
    });
    try {
      await dialog
        .getByLabel('Short title', { exact: true })
        .fill('Wi-Fi and projector connection blocked');
      await started;
      await dialog.getByLabel('Service area', { exact: true }).selectOption('facilities');
      await expect(
        dialog
          .locator('.related-guides summary')
          .filter({ hasText: 'Reporting a room or equipment problem' }),
      ).toBeVisible();
    } finally {
      release();
    }
    await ended;
    await f.page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await expect(dialog.locator('.related-guides')).not.toContainText('Connecting to campus Wi-Fi');
    await expect(dialog.getByRole('textbox', { name: /^Tell us a little more/ })).toHaveValue(
      description,
    );
    let releaseSave, saveReached;
    const saveGate = new Promise((done) => {
        releaseSave = done;
      }),
      saveStarted = new Promise((done) => {
        saveReached = done;
      });
    await f.page.route('**/api/tickets', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      saveReached();
      await saveGate;
      await route.fulfill({ response });
    });
    try {
      await dialog.getByRole('button', { name: 'Submit request', exact: true }).click();
      await saveStarted;
      await expect(dialog.getByLabel('Short title', { exact: true })).toBeDisabled();
      await expect(dialog.getByLabel('Service area', { exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
      await expect(
        dialog.getByRole('button', { name: 'Close new request', exact: true }),
      ).toBeDisabled();
      await f.page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
    } finally {
      releaseSave();
    }
    await expect(
      f.page.getByRole('dialog', { name: 'Support request details', exact: true }),
    ).toBeVisible();
    const saved = service.db
      .prepare('SELECT category,description FROM tickets WHERE title=?')
      .all('Wi-Fi and projector connection blocked');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].category, 'facilities');
    assert.equal(saved[0].description, description);
  },
);
test(
  'the student knowledge library and article fit a mobile viewport',
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t, 'student', { viewport: { width: 390, height: 844 } });
    await library(f);
    await expect(f.page.locator('.knowledge-card').first()).toBeVisible();
    assert(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(f.page, 'knowledge-mobile');
    await f.page
      .getByRole('button', { name: 'Open guide: Connecting to campus Wi-Fi', exact: true })
      .click();
    await expect(f.page.locator('.knowledge-body')).toContainText('Never include your password');
    assert(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await capture(f.page, 'guide-mobile');
  },
);
test(
  'refreshing an article clears it when staff archive the published guide',
  { timeout: 45000 },
  async (t) => {
    const staff = await fixture(t),
      student = await fixture(t, 'student');
    const draft = await create(staff, { title: 'Temporary public guide for review' }),
      guide = await publish(staff, draft);
    await open(student, guide.title);
    await expect(student.page.locator('.knowledge-body')).toBeVisible();
    const response = await staff.context.request.post(base + '/api/guides/' + guide.id + '/state', {
      headers: staff.headers,
      data: { version: guide.version, state: 'archived' },
    });
    assert.equal(response.status(), 200);
    await student.page.getByRole('button', { name: 'Refresh guide', exact: true }).click();
    await expect(student.page.getByRole('alert')).toContainText('Guide not found');
    await expect(student.page.locator('.knowledge-body')).toHaveCount(0);
  },
);
test(
  'an expired editorial session clears the editor and cannot save a staff draft',
  { timeout: 45000 },
  async (t) => {
    const f = await fixture(t);
    await library(f);
    await f.page.getByRole('button', { name: 'New guide', exact: true }).click();
    const input = { ...fields, title: 'This expired draft must not be saved' };
    await fill(f, input);
    service.db
      .prepare('UPDATE sessions SET expires_at=? WHERE user_id=?')
      .run(Date.now() - 1000, f.user.id);
    await f.page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(f.page.getByLabel('Email address', { exact: true })).toBeVisible();
    await expect(f.page.getByLabel('Guide title', { exact: true })).toHaveCount(0);
    assert.equal(
      service.db.prepare('SELECT count(*) n FROM knowledge_guides WHERE title=?').get(input.title)
        .n,
      0,
    );
  },
);
