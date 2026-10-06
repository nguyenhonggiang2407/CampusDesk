import express, { type Request, type Response } from 'express';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { openDatabase, seedDemo } from './database.js';
import { hashPassword, verifyPassword } from './password.js';
import { categories, priorities, statuses, statusLabels, transitions, type User, type Ticket, type TicketDetail, type Role } from '../shared/types.js';

interface Options { databasePath: string; seedDemo?: boolean; origin: string; secureCookies?: boolean; serveClient?: boolean; }
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const sessionCookie = 'campus_session';
const day = () => new Date().toISOString().slice(0, 10);
const validDate = (value: string) => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const credentials = z.object({ email: z.string().trim().email().max(190).transform(v => v.toLowerCase()), password: z.string().min(1).max(200) }).strict();
const createTicket = z.object({ title: z.string().trim().min(5, 'Use at least 5 characters for the title.').max(120), description: z.string().trim().min(20, 'Include at least 20 characters of detail.').max(5000), category: z.enum(categories), priority: z.enum(priorities) }).strict();
const patchTicket = z.object({ version: z.number().int().positive(), status: z.enum(statuses).optional(), priority: z.enum(priorities).optional(), assignedTo: z.number().int().positive().nullable().optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDate, 'Choose a valid calendar date.').optional() }).strict().refine(v => Object.keys(v).length > 1, 'Choose a change to save.');

export async function createApp(options: Options) {
  const db = openDatabase(options.databasePath);
  if (options.seedDemo) await seedDemo(db);
  const app = express();
  app.disable('x-powered-by');
  const allowedOrigin = new URL(options.origin).origin;
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  const contexts = new WeakMap<Request, { user: User; csrf: string; tokenHash: string }>();
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin' });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== allowedOrigin) return res.status(403).json({ error: 'This request came from an untrusted origin.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Use application/json for this request.' });
    }
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', (req, _res, next) => {
    const raw = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
    if (raw && /^[a-f0-9]{64}$/.test(raw)) {
      const tokenHash = digest(raw);
      const row = db.prepare('SELECT u.id,u.name,u.email,u.role,s.csrf_token,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(tokenHash) as (User & { csrf_token: string; expires_at: number }) | undefined;
      if (row && row.expires_at > Date.now()) contexts.set(req, { user: { id: row.id, name: row.name, email: row.email, role: row.role }, csrf: row.csrf_token, tokenHash });
      else if (row) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
    }
    next();
  });
  function auth(req: Request, staffOnly = false, mutation = false) {
    const ctx = contexts.get(req);
    if (!ctx) throw new ApiError(401, 'Sign in to continue.');
    if (staffOnly && ctx.user.role !== 'staff') throw new ApiError(403, 'This action is available to staff only.');
    if (mutation) {
      const token = req.headers['x-csrf-token'];
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token, 'ascii'), Buffer.from(ctx.csrf, 'ascii'))) throw new ApiError(403, 'Your security token expired. Refresh and try again.');
    }
    return ctx;
  }
  function startSession(req: Request, res: Response, user: User) {
    const old = contexts.get(req); if (old) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(old.tokenHash);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    // Bound active sessions per account, including the shared fictional demo users.
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT -1 OFFSET 9)').run(user.id, user.id);
    db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)').run(digest(token), user.id, csrf, Date.now() + 12 * 60 * 60_000);
    res.cookie(sessionCookie, token, { httpOnly: true, secure: !!options.secureCookies, sameSite: 'lax', path: '/', maxAge: 12 * 60 * 60_000 });
    return { user, csrfToken: csrf };
  }
  function lookup(id: string, viewer: User) {
    const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(id) as Record<string, any> | undefined;
    if (!row || (viewer.role === 'student' && row.student_id !== viewer.id)) throw new ApiError(404, 'Request not found.');
    return row;
  }
  const ticketSelect = `SELECT t.*,s.name AS student_name,a.name AS assigned_name,
    (SELECT COUNT(*) FROM comments c WHERE c.ticket_id=t.id AND (c.visibility='public' OR ?='staff')) AS comment_count
    FROM tickets t JOIN users s ON s.id=t.student_id LEFT JOIN users a ON a.id=t.assigned_to`;
  function shape(row: Record<string, any>): Ticket {
    return { id: row.id, reference: `CD-${row.sequence}`, title: row.title, description: row.description, category: row.category, priority: row.priority, status: row.status, studentId: row.student_id, studentName: row.student_name, assignedTo: row.assigned_to, assignedName: row.assigned_name, dueDate: row.due_date, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version, commentCount: row.comment_count };
  }
  function detail(id: string, viewer: User): TicketDetail {
    lookup(id, viewer);
    const ticket = shape(db.prepare(`${ticketSelect} WHERE t.id=?`).get(viewer.role, id) as Record<string, any>);
    const comments = db.prepare(`SELECT c.id,u.name AS authorName,u.role AS authorRole,c.body,c.visibility,c.created_at AS createdAt FROM comments c JOIN users u ON u.id=c.author_id WHERE c.ticket_id=? AND (c.visibility='public' OR ?='staff') ORDER BY c.id`).all(id, viewer.role) as unknown as TicketDetail['comments'];
    const events = db.prepare('SELECT e.id,u.name AS actorName,e.message,e.created_at AS createdAt FROM ticket_events e JOIN users u ON u.id=e.actor_id WHERE e.ticket_id=? ORDER BY e.id').all(id) as unknown as TicketDetail['events'];
    return { ...ticket, comments, events };
  }
  function tx(fn: () => void) { db.exec('BEGIN IMMEDIATE'); try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } }
  const event = (id: string, actor: number, message: string, time: string) => db.prepare('INSERT INTO ticket_events(ticket_id,actor_id,message,created_at) VALUES(?,?,?,?)').run(id, actor, message, time);
  function throttle(scope: string, req: Request, maximum: number, windowMs = 15 * 60_000) {
    const now = Date.now(), key = digest(`${scope}|${req.ip}`);
    db.prepare('DELETE FROM login_limits WHERE resets_at <= ?').run(now);
    const limit = db.prepare('SELECT attempts FROM login_limits WHERE limit_key=?').get(key) as { attempts: number } | undefined;
    if (limit && limit.attempts >= maximum) throw new ApiError(429, 'Too many requests. Wait a little before trying again.');
    if (!limit && (db.prepare('SELECT COUNT(*) AS n FROM login_limits').get() as { n: number }).n >= 5000) throw new ApiError(429, 'The service is busy. Try again shortly.');
    db.prepare('INSERT INTO login_limits(limit_key,attempts,resets_at) VALUES(?,1,?) ON CONFLICT(limit_key) DO UPDATE SET attempts=attempts+1').run(key, now + windowMs);
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/session', (req, res) => { const ctx = contexts.get(req); res.json({ user: ctx?.user ?? null, csrfToken: ctx?.csrf ?? null }); });
  app.post('/api/auth/login', async (req, res) => {
    throttle('login', req, 30);
    const input = credentials.parse(req.body), key = digest(`${req.ip}|${input.email}`), now = Date.now();
    const limit = db.prepare('SELECT attempts,resets_at FROM login_limits WHERE limit_key=?').get(key) as { attempts: number; resets_at: number } | undefined;
    if (limit && limit.resets_at > now && limit.attempts >= 5) throw new ApiError(429, 'Too many attempts. Try again in 15 minutes.');
    const row = db.prepare('SELECT * FROM users WHERE email=?').get(input.email) as (User & { password_hash: string }) | undefined;
    const verified = await verifyPassword(input.password, row?.password_hash ?? dummyHash);
    if (!row || !verified) {
      db.prepare('INSERT INTO login_limits(limit_key,attempts,resets_at) VALUES(?,1,?) ON CONFLICT(limit_key) DO UPDATE SET attempts=CASE WHEN resets_at <= ? THEN 1 ELSE attempts+1 END,resets_at=CASE WHEN resets_at <= ? THEN excluded.resets_at ELSE resets_at END').run(key, now + 15 * 60_000, now, now);
      throw new ApiError(401, 'Email or password is incorrect.');
    }
    db.prepare('DELETE FROM login_limits WHERE limit_key=?').run(key);
    res.json(startSession(req, res, { id: row.id, name: row.name, email: row.email, role: row.role }));
  });
  app.post('/api/auth/register', async (req, res) => {
    throttle('register', req, 5);
    const input = credentials.extend({ name: z.string().trim().min(2).max(80), password: z.string().min(12, 'Choose a password with at least 12 characters.').max(200) }).parse(req.body);
    if (db.prepare('SELECT id FROM users WHERE email=?').get(input.email)) throw new ApiError(409, 'An account with this email already exists.');
    const hash = await hashPassword(input.password);
    // The pre-check is useful feedback; the unique constraint also handles parallel registrations.
    if (db.prepare('SELECT id FROM users WHERE email=?').get(input.email)) throw new ApiError(409, 'An account with this email already exists.');
    const result = db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'student')").run(input.name, input.email, hash);
    res.status(201).json(startSession(req, res, { id: Number(result.lastInsertRowid), name: input.name, email: input.email, role: 'student' }));
  });
  app.post('/api/auth/logout', (req, res) => {
    const ctx = auth(req, false, true); db.prepare('DELETE FROM sessions WHERE token_hash=?').run(ctx.tokenHash);
    res.clearCookie(sessionCookie, { httpOnly: true, secure: !!options.secureCookies, sameSite: 'lax', path: '/' }); res.status(204).end();
  });
  app.get('/api/staff', (req, res) => { auth(req, true); res.json(db.prepare("SELECT id,name FROM users WHERE role='staff' ORDER BY name").all()); });
  app.get('/api/summary', (req, res) => {
    const { user } = auth(req); const scoped = user.role === 'student' ? 'WHERE student_id=?' : ''; const params = user.role === 'student' ? [day(), user.id] : [day()];
    const result = db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(status NOT IN ('resolved','closed')),0) AS open,COALESCE(SUM(status NOT IN ('resolved','closed') AND due_date < ?),0) AS overdue,COALESCE(SUM(status IN ('resolved','closed')),0) AS resolved,COALESCE(SUM(assigned_to IS NULL AND status NOT IN ('resolved','closed')),0) AS unassigned,COALESCE(SUM(priority='high' AND status NOT IN ('resolved','closed')),0) AS highPriority FROM tickets ${scoped}`).get(...params);
    res.json(result);
  });
  app.get('/api/tickets', (req, res) => {
    const { user } = auth(req);
    const q = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1), search: z.string().trim().max(100).optional(), status: z.enum([...statuses, 'open']).optional(), category: z.enum(categories).optional(), priority: z.enum(priorities).optional(), assigned: z.enum(['mine', 'unassigned']).optional() }).strict().parse(req.query);
    if (q.assigned && user.role !== 'staff') throw new ApiError(403, 'Assignment filters are available to staff only.');
    const clauses = ['1=1'], params: (string | number)[] = [];
    if (user.role === 'student') { clauses.push('t.student_id=?'); params.push(user.id); }
    if (q.search) { clauses.push('(t.title LIKE ? OR t.description LIKE ? OR CAST(t.sequence AS TEXT) LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search.replace(/^CD-/i, '')}%`); }
    if (q.status === 'open') clauses.push("t.status NOT IN ('resolved','closed')"); else if (q.status) { clauses.push('t.status=?'); params.push(q.status); }
    if (q.category) { clauses.push('t.category=?'); params.push(q.category); }
    if (q.priority) { clauses.push('t.priority=?'); params.push(q.priority); }
    if (q.assigned === 'mine') { clauses.push('t.assigned_to=?'); params.push(user.id); } else if (q.assigned === 'unassigned') clauses.push('t.assigned_to IS NULL');
    const where = clauses.join(' AND '), count = (db.prepare(`SELECT COUNT(*) AS n FROM tickets t WHERE ${where}`).get(...params) as { n: number }).n;
    const tickets = db.prepare(`${ticketSelect} WHERE ${where} ORDER BY t.updated_at DESC,t.sequence DESC LIMIT 20 OFFSET ?`).all(user.role, ...params, (q.page - 1) * 20).map(shape);
    res.json({ tickets, total: count, page: q.page, pages: Math.max(1, Math.ceil(count / 20)) });
  });
  app.get('/api/tickets/:id', (req, res) => { const { user } = auth(req); res.json(detail(z.string().uuid().parse(req.params.id), user)); });
  app.post('/api/tickets', (req, res) => {
    const { user } = auth(req, false, true); if (user.role !== 'student') throw new ApiError(403, 'Only students submit new requests.');
    throttle(`create:${user.id}`, req, 20, 60 * 60_000);
    const input = createTicket.parse(req.body), id = randomUUID(), time = new Date().toISOString(), due = new Date(Date.now() + ({ high: 2, normal: 5, low: 7 }[input.priority]) * 86_400_000).toISOString().slice(0, 10);
    tx(() => {
      const sequence = (db.prepare('SELECT COALESCE(MAX(sequence),1000)+1 AS n FROM tickets').get() as { n: number }).n;
      db.prepare("INSERT INTO tickets(id,sequence,title,description,category,priority,status,student_id,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,'new',?,?,?,?)").run(id, sequence, input.title, input.description, input.category, input.priority, user.id, due, time, time);
      event(id, user.id, 'Request submitted', time);
    });
    res.status(201).json(detail(id, user));
  });
  app.patch('/api/tickets/:id', (req, res) => {
    const { user } = auth(req, true, true), id = z.string().uuid().parse(req.params.id), input = patchTicket.parse(req.body), row = lookup(id, user);
    if (row.version !== input.version) throw new ApiError(409, 'This request changed. Refresh it before saving.');
    if (input.status && input.status !== row.status && !transitions[row.status as keyof typeof transitions].includes(input.status)) throw new ApiError(409, `Cannot move from ${statusLabels[row.status as keyof typeof statusLabels]} to ${statusLabels[input.status]}.`);
    if (input.assignedTo != null && !db.prepare("SELECT id FROM users WHERE id=? AND role='staff'").get(input.assignedTo)) throw new ApiError(400, 'Assign the request to an existing staff member.');
    const status = input.status ?? row.status, priority = input.priority ?? row.priority, assigned = input.assignedTo === undefined ? row.assigned_to : input.assignedTo, due = input.dueDate ?? row.due_date;
    const messages: string[] = [];
    if (status !== row.status) messages.push(`Status changed to ${statusLabels[status as keyof typeof statusLabels]}`);
    if (priority !== row.priority) messages.push(`Priority changed to ${priority}`);
    if (assigned !== row.assigned_to) messages.push(assigned === null ? 'Assignment removed' : 'Staff assignment updated');
    if (due !== row.due_date) messages.push(`Target date changed to ${due}`);
    if (!messages.length) return res.json(detail(id, user));
    const time = new Date().toISOString();
    tx(() => { const updated = db.prepare('UPDATE tickets SET status=?,priority=?,assigned_to=?,due_date=?,updated_at=?,version=version+1 WHERE id=? AND version=?').run(status, priority, assigned, due, time, id, input.version); if (!updated.changes) throw new ApiError(409, 'This request changed. Refresh it before saving.'); messages.forEach(message => event(id, user.id, message, time)); });
    res.json(detail(id, user));
  });
  app.post('/api/tickets/:id/comments', (req, res) => {
    const { user } = auth(req, false, true), id = z.string().uuid().parse(req.params.id), row = lookup(id, user);
    throttle(`comments:${user.id}`, req, 60, 60 * 60_000);
    const input = z.object({ body: z.string().trim().min(1, 'Write a reply first.').max(3000), visibility: z.enum(['public', 'private']).default('public') }).strict().parse(req.body);
    if (input.visibility === 'private' && user.role !== 'staff') throw new ApiError(403, 'Only staff can add internal notes.');
    if (row.status === 'closed') throw new ApiError(409, 'Staff must reopen this request before a new reply can be added.');
    const time = new Date().toISOString();
    tx(() => { db.prepare('INSERT INTO comments(ticket_id,author_id,body,visibility,created_at) VALUES(?,?,?,?,?)').run(id, user.id, input.body, input.visibility, time); db.prepare('UPDATE tickets SET updated_at=?,version=version+1 WHERE id=?').run(time, id); });
    res.status(201).json(detail(id, user));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  if (options.serveClient) {
    const directory = resolve('dist/client');
    if (existsSync(`${directory}/index.html`)) { app.use(express.static(directory)); app.use((req, res, next) => req.method === 'GET' ? res.sendFile(`${directory}/index.html`) : next()); }
  }
  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message || 'Check your input.' });
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON body.' });
    if ((error as { type?: string })?.type === 'entity.too.large') return res.status(413).json({ error: 'This request is too large.' });
    console.error('Request failed:', error instanceof Error ? error.message : 'unknown error');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return { app, db, close: () => db.close() };
}
