import type express from 'express';
import type { Request } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { categories, type User } from '../shared/types.js';
import { guideStates } from '../shared/knowledge.js';
import { ApiError } from './errors.js';
import { KnowledgeStore } from './knowledge-store.js';

const text = (min: number, max: number, multiline = false) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').trim().normalize('NFC'))
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine(
          (value) =>
            !(
              multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/
            ).test(value),
          'Remove control characters from this field.',
        ),
    );
const input = z
  .object({
    title: text(5, 120),
    summary: text(20, 240),
    body: text(40, 8000, true),
    category: z.enum(categories),
  })
  .strict();
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const id = (req: Request) => z.string().uuid().parse(req.params.id);
export function registerKnowledge(
  app: express.Express,
  db: DatabaseSync,
  auth: (req: Request, staffOnly?: boolean, mutation?: boolean) => { user: User },
  throttle: (scope: string, req: Request, maximum: number, window?: number) => void,
) {
  const store = new KnowledgeStore(db);
  app.get('/api/guides', (req, res) => {
    const { user } = auth(req);
    const q = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        search: z.string().trim().max(100).optional(),
        category: z.enum(categories).optional(),
        state: z.enum(guideStates).optional(),
      })
      .strict()
      .parse(req.query);
    if (q.state && user.role !== 'staff')
      throw new ApiError(403, 'Publication filters are available to staff only.');
    res.json(store.list(user.role, q));
  });
  app.get('/api/guides/suggestions', (req, res) => {
    auth(req);
    const q = z
      .object({ category: z.enum(categories), search: z.string().trim().max(120).default('') })
      .strict()
      .parse(req.query);
    res.json({ guides: store.suggestions(q.category, q.search) });
  });
  app.get('/api/guides/:id', (req, res) => {
    const { user } = auth(req);
    res.json(store.get(id(req), user.role));
  });
  app.get('/api/guides/:id/history', (req, res) => {
    auth(req, true);
    res.json({ events: store.history(id(req)) });
  });
  app.post('/api/guides', (req, res) => {
    const { user } = auth(req, true, true);
    const value = input.extend({ requestId: z.string().uuid() }).parse(req.body);
    throttle('guide-create:' + user.id, req, 30, 60 * 60_000);
    const { requestId, ...fields } = value;
    const result = store.create(user.id, requestId, fields);
    res.status(result.replayed ? 200 : 201).json(result.guide);
  });
  app.patch('/api/guides/:id', (req, res) => {
    const { user } = auth(req, true, true);
    const value = input.extend({ version }).parse(req.body);
    const { version: expected, ...fields } = value;
    res.json(store.update(id(req), user.id, expected, fields));
  });
  app.post('/api/guides/:id/state', (req, res) => {
    const { user } = auth(req, true, true);
    const value = z
      .object({ version, state: z.enum(guideStates) })
      .strict()
      .parse(req.body);
    res.json(store.setState(id(req), user.id, value.version, value.state));
  });
}
