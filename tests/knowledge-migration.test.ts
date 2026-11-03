import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, seedDemo } from '../server/database.js';
import { KnowledgeStore } from '../server/knowledge-store.js';

test('v1 upgrades preserve accounts, sessions, requests and private replies without injecting demo data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'campus-v1-')),
    path = join(dir, 'old.sqlite');
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path);
    db.exec(readFileSync(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8'));
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(
      1,
      'Existing Student',
      'student@existing.test',
      'original-password-hash',
      'student',
    );
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(
      2,
      'Existing Staff',
      'staff@existing.test',
      'original-staff-hash',
      'staff',
    );
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(
      'a'.repeat(64),
      1,
      'b'.repeat(64),
      Date.now() + 60000,
    );
    const id = randomUUID();
    db.prepare(
      'INSERT INTO tickets(id,sequence,title,description,category,priority,status,student_id,due_date,created_at,updated_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id,
      1001,
      'Original request',
      'The original student request must remain unchanged.',
      'it',
      'normal',
      'new',
      1,
      '2030-04-19',
      '2030-04-01T10:00:00Z',
      '2030-04-01T10:00:00Z',
      4,
    );
    db.prepare(
      'INSERT INTO comments(ticket_id,author_id,body,visibility,created_at) VALUES(?,?,?,?,?)',
    ).run(id, 2, 'Original private staff reply', 'private', '2030-04-01T11:00:00Z');
    const original = {
      users: db.prepare('SELECT * FROM users ORDER BY id').all(),
      sessions: db.prepare('SELECT * FROM sessions').all(),
      tickets: db.prepare('SELECT * FROM tickets').all(),
      comments: db.prepare('SELECT * FROM comments').all(),
    };
    db.close();
    db = openDatabase(path);
    assert.equal(
      (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      2,
    );
    for (const table of ['users', 'sessions', 'tickets', 'comments'] as const)
      assert.deepEqual(
        db.prepare('SELECT * FROM ' + table + (table === 'users' ? ' ORDER BY id' : '')).all(),
        original[table],
      );
    assert.equal(
      (db.prepare('SELECT count(*) n FROM knowledge_guides').get() as { n: number }).n,
      0,
    );
    await seedDemo(db);
    assert.equal((db.prepare('SELECT count(*) n FROM users').get() as { n: number }).n, 2);
    assert.equal(
      (db.prepare('SELECT count(*) n FROM knowledge_guides').get() as { n: number }).n,
      0,
    );
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('a future schema is rejected without downgrading its version or modifying its tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'campus-future-')),
    path = join(dir, 'future.sqlite');
  try {
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE future_content(message TEXT); INSERT INTO future_content VALUES('Keep this future data'); PRAGMA user_version=99;",
    );
    db.close();
    assert.throws(() => openDatabase(path), /newer CampusDesk/);
    const reopened = new DatabaseSync(path);
    try {
      assert.equal(
        (reopened.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
        99,
      );
      assert.equal(
        (reopened.prepare('SELECT message FROM future_content').get() as { message: string })
          .message,
        'Keep this future data',
      );
      assert.equal(
        reopened.prepare("SELECT name FROM sqlite_master WHERE name='knowledge_guides'").get(),
        undefined,
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('guide content, publication, history and idempotency survive reopening and demo seeding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'campus-guides-')),
    path = join(dir, 'campus.sqlite');
  let db: DatabaseSync | undefined;
  try {
    db = openDatabase(path);
    await seedDemo(db);
    let store = new KnowledgeStore(db);
    const input = {
      title: 'Guide kept after restart',
      summary: 'This fictional guide is kept when the database reopens.',
      category: 'it' as const,
      body: 'The complete guide text must survive reopening, together with its publication and creation request key.',
    };
    const requestId = randomUUID(),
      created = store.create(2, requestId, input);
    store.setState(created.guide.id, 2, 1, 'published');
    const expected = store.get(created.guide.id, 'student');
    db.close();
    db = openDatabase(path);
    await seedDemo(db);
    store = new KnowledgeStore(db);
    assert.deepEqual(store.get(created.guide.id, 'student'), expected);
    const replay = store.create(2, requestId, input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.guide.id, created.guide.id);
    assert.equal(replay.guide.version, 2);
    assert.equal(store.history(created.guide.id).length, 2);
    assert.equal(
      (db.prepare('SELECT count(*) n FROM knowledge_guides').get() as { n: number }).n,
      5,
    );
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('an interrupted demo seed rolls back both support data and knowledge content', async () => {
  const db = openDatabase(':memory:');
  try {
    db.exec(
      "CREATE TEMP TRIGGER stop_demo BEFORE INSERT ON knowledge_guides BEGIN SELECT RAISE(ABORT,'synthetic seed failure'); END;",
    );
    await assert.rejects(() => seedDemo(db), /synthetic seed failure/);
    for (const table of [
      'users',
      'tickets',
      'comments',
      'ticket_events',
      'knowledge_guides',
      'knowledge_events',
    ])
      assert.equal((db.prepare('SELECT count(*) n FROM ' + table).get() as { n: number }).n, 0);
    db.exec('DROP TRIGGER stop_demo');
    await seedDemo(db);
    assert.equal((db.prepare('SELECT count(*) n FROM users').get() as { n: number }).n, 4);
    assert.equal(
      (db.prepare('SELECT count(*) n FROM knowledge_guides').get() as { n: number }).n,
      4,
    );
  } finally {
    db.close();
  }
});
