import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { openDatabase } from './database.js';
import { hashPassword } from './password.js';

// Run this on the trusted server. It never accepts a role or promotes an existing user.
let muted = false;
const output = new Writable({ write(chunk, _encoding, done) { if (!muted) process.stdout.write(chunk); done(); } });
const interactive = process.stdin.isTTY;
const rl = interactive ? createInterface({ input: process.stdin, output, terminal: true }) : null;
async function value(key: string, question: string, secret = false) {
  if (process.env[key]) return process.env[key]!;
  if (!rl) throw new Error(`Set ${key} for non-interactive provisioning. Keep the password out of command arguments and source control.`);
  if (secret) { process.stdout.write(question); muted = true; }
  try { return await rl.question(secret ? '' : question); }
  finally { if (secret) { muted = false; process.stdout.write('\n'); } }
}
let db: ReturnType<typeof openDatabase> | undefined;
try {
  const name = await value('STAFF_NAME', 'Staff display name: ');
  const email = await value('STAFF_EMAIL', 'Staff email: ');
  const password = await value('STAFF_PASSWORD', 'Password (hidden, 12+ characters): ', true);
  const staff = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(190).transform(v => v.toLowerCase()), password: z.string().min(12).max(200) }).parse({ name, email, password });
  db = openDatabase(process.env.DATABASE_PATH || './data/campusdesk.sqlite');
  if (db.prepare('SELECT id FROM users WHERE email=?').get(staff.email)) throw new Error('This email already exists. No account was changed.');
  const passwordHash = await hashPassword(staff.password);
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'staff')").run(staff.name, staff.email, passwordHash);
  console.log('Staff account created. The password has not been written to a configuration file.');
} catch (error) {
  console.error(error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : 'Unable to provision staff.');
  process.exitCode = 1;
} finally { rl?.close(); db?.close(); }
