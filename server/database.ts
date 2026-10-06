import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './password.js';

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','staff'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_limits (limit_key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, resets_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY, sequence INTEGER UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('facilities','it','student_affairs')),
      priority TEXT NOT NULL CHECK(priority IN ('low','normal','high')),
      status TEXT NOT NULL CHECK(status IN ('new','triaged','in_progress','resolved','closed')),
      student_id INTEGER NOT NULL REFERENCES users(id), assigned_to INTEGER REFERENCES users(id),
      due_date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS ticket_owner ON tickets(student_id,updated_at);
    CREATE INDEX IF NOT EXISTS ticket_queue ON tickets(status,due_date);
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK(visibility IN ('public','private')), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ticket_events (
      id INTEGER PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      actor_id INTEGER NOT NULL REFERENCES users(id), message TEXT NOT NULL, created_at TEXT NOT NULL
    );
    PRAGMA user_version = 1;
  `);
  return db;
}

export async function seedDemo(db: DatabaseSync): Promise<void> {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (count.n) return;
  const passwordHash = await hashPassword('CampusDemo!2026');
  const user = db.prepare('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)');
  user.run(1, 'Alex Morgan', 'student@campus.example.test', passwordHash, 'student');
  user.run(2, 'Sam Rivera', 'staff@campus.example.test', passwordHash, 'staff');
  user.run(3, 'Jordan Lee', 'jordan@campus.example.test', passwordHash, 'staff');
  user.run(4, 'Taylor Park', 'other@campus.example.test', passwordHash, 'student');
  const today = new Date();
  const date = (days: number) => new Date(today.getTime() + days * 86_400_000).toISOString();
  const rows = [
    ['Projector in room B204 is not working', 'The projector switches on but does not display a picture. We tried two laptops and the HDMI cable. Our seminar is on Thursday morning.', 'facilities', 'high', 'in_progress', 1, 3, 1, -2],
    ['Cannot connect to campus Wi-Fi', 'My laptop cannot connect to the campus network in the north library. It keeps asking for my password although the same account works on the student portal.', 'it', 'normal', 'triaged', 1, 2, 3, -1],
    ['Request for enrollment confirmation', 'I need a digital enrollment confirmation for my scholarship application. Please let me know which information or form is required.', 'student_affairs', 'normal', 'resolved', 1, 2, 4, -4],
    ['A reading light is flickering in the library', 'The lamp at study desk 16 on the second floor is flickering. I reported it to the front desk and was asked to submit a service request.', 'facilities', 'low', 'new', 1, null, 6, 0],
    ['Student portal access after password reset', 'After resetting my password, I can no longer open the course selection page. The page displays an access denied message.', 'it', 'high', 'new', 4, null, -1, -3],
    ['Lost access card replacement', 'My campus access card was lost yesterday. I have already disabled it through the student portal and need a replacement.', 'student_affairs', 'normal', 'closed', 4, 2, 2, -6],
  ] as const;
  const ticket = db.prepare('INSERT INTO tickets(id,sequence,title,description,category,priority,status,student_id,assigned_to,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  const comment = db.prepare('INSERT INTO comments(ticket_id,author_id,body,visibility,created_at) VALUES(?,?,?,?,?)');
  const event = db.prepare('INSERT INTO ticket_events(ticket_id,actor_id,message,created_at) VALUES(?,?,?,?)');
  rows.forEach((r, index) => {
    const id = randomUUID();
    const created = date(r[8]);
    ticket.run(id, 1001 + index, r[0], r[1], r[2], r[3], r[4], r[5], r[6], date(r[7]).slice(0, 10), created, created);
    event.run(id, r[5], 'Request submitted', created);
    if (index === 0) {
      comment.run(id, 3, 'Thanks for the details, Alex. I will test the projector and cable before your seminar.', 'public', date(-1));
      comment.run(id, 3, 'Internal demo note: spare cable reserved with the facilities team.', 'private', date(-1));
    }
    if (index === 2) comment.run(id, 2, 'Your digital confirmation is available from the documents section of the student portal. Please reply if you still need help.', 'public', date(-2));
  });
}
