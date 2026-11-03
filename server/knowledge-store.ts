import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import type { Category, Role } from '../shared/types.js';
import type {
  GuideInput,
  GuideState,
  KnowledgeGuide,
  GuidePage,
  GuideEvent,
  GuideSummary,
} from '../shared/knowledge.js';

export function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('đ', 'd').trim();
}
const terms = (value: string) =>
  [...new Set(normalizeSearch(value).split(/\s+/).filter(Boolean))].slice(0, 8);
const columns = 'id,title,summary,category,state,version,updated_at AS updatedAt';
const row = (r: Record<string, any>): KnowledgeGuide => ({
  id: r.id,
  title: r.title,
  summary: r.summary,
  category: r.category,
  state: r.state,
  version: r.version,
  updatedAt: r.updated_at,
  body: r.body,
});

export function installKnowledgeSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_guides (
      id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 120),
      summary TEXT NOT NULL CHECK(length(summary) BETWEEN 20 AND 240),
      body TEXT NOT NULL CHECK(length(body) BETWEEN 40 AND 8000),
      category TEXT NOT NULL CHECK(category IN ('facilities','it','student_affairs')),
      state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','archived')),
      search_text TEXT NOT NULL, title_search TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS knowledge_visibility ON knowledge_guides(state,category,updated_at DESC);
    CREATE TABLE IF NOT EXISTS knowledge_events (
      id INTEGER PRIMARY KEY, guide_id TEXT NOT NULL REFERENCES knowledge_guides(id) ON DELETE CASCADE,
      actor_id INTEGER NOT NULL REFERENCES users(id), version INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created','edited','state_changed')),
      state TEXT NOT NULL CHECK(state IN ('draft','published','archived')), created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS knowledge_create_keys (
      actor_id INTEGER NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
      digest TEXT NOT NULL, guide_id TEXT NOT NULL REFERENCES knowledge_guides(id) ON DELETE CASCADE,
      PRIMARY KEY(actor_id,request_id)
    ) STRICT;
  `);
}
export class KnowledgeStore {
  constructor(readonly db: DatabaseSync) {}
  private atomic<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  get(id: string, role: Role): KnowledgeGuide {
    const value = this.db
      .prepare("SELECT * FROM knowledge_guides WHERE id=? AND (?='staff' OR state='published')")
      .get(id, role);
    if (!value) throw new ApiError(404, 'Guide not found.');
    return row(value);
  }
  list(
    role: Role,
    input: { search?: string; category?: Category; state?: GuideState; page: number },
  ): GuidePage {
    const clauses = [role === 'student' ? "state='published'" : '1=1'];
    const values: (number | string)[] = [];
    if (input.category) {
      clauses.push('category=?');
      values.push(input.category);
    }
    if (input.state) {
      clauses.push('state=?');
      values.push(input.state);
    }
    for (const term of terms(input.search ?? '')) {
      clauses.push('instr(search_text,?)>0');
      values.push(term);
    }
    const where = clauses.join(' AND ');
    const total = (
      this.db.prepare(`SELECT count(*) n FROM knowledge_guides WHERE ${where}`).get(...values) as {
        n: number;
      }
    ).n;
    const guides = this.db
      .prepare(
        `SELECT ${columns} FROM knowledge_guides WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT 12 OFFSET ?`,
      )
      .all(...values, (input.page - 1) * 12) as unknown as GuideSummary[];
    return { guides, total, page: input.page, pages: Math.max(1, Math.ceil(total / 12)) };
  }
  suggestions(category: Category, search: string): GuideSummary[] {
    const words = terms(search).filter(
      (word) =>
        word.length >= 2 &&
        ![
          'the',
          'and',
          'with',
          'for',
          'not',
          'can',
          'cannot',
          'this',
          'that',
          'cua',
          'cho',
          'voi',
          'khong',
        ].includes(word),
    );
    const score = words.length
      ? words
          .map(
            () =>
              '(CASE WHEN instr(title_search,?)>0 THEN 2 ELSE 0 END + CASE WHEN instr(search_text,?)>0 THEN 1 ELSE 0 END)',
          )
          .join('+')
      : '0';
    const values = words.flatMap((word) => [word, word]);
    const result = this.db
      .prepare(
        `SELECT ${columns},(${score}) AS score FROM knowledge_guides WHERE state='published' AND category=? ORDER BY score DESC,updated_at DESC,id DESC LIMIT 3`,
      )
      .all(...values, category) as unknown as (GuideSummary & { score: number })[];
    return result.map(({ score: _score, ...guide }) => guide);
  }
  private event(
    id: string,
    actor: number,
    version: number,
    action: GuideEvent['action'],
    state: GuideState,
    now: string,
  ) {
    this.db
      .prepare(
        'INSERT INTO knowledge_events(guide_id,actor_id,version,action,state,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(id, actor, version, action, state, now);
  }
  create(actor: number, requestId: string, input: GuideInput) {
    const digest = createHash('sha256')
      .update(JSON.stringify([input.title, input.summary, input.category, input.body]))
      .digest('hex');
    return this.atomic(() => {
      const existing = this.db
        .prepare(
          'SELECT digest,guide_id FROM knowledge_create_keys WHERE actor_id=? AND request_id=?',
        )
        .get(actor, requestId) as { digest: string; guide_id: string } | undefined;
      if (existing) {
        if (existing.digest !== digest)
          throw new ApiError(
            409,
            'This draft was already created with different text. Refresh the library to open the saved guide.',
          );
        return { guide: this.get(existing.guide_id, 'staff'), replayed: true };
      }
      if (
        (this.db.prepare('SELECT count(*) n FROM knowledge_guides').get() as { n: number }).n >= 500
      )
        throw new ApiError(409, 'The library has reached its 500-guide limit.');
      const id = randomUUID(),
        now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO knowledge_guides(id,title,summary,body,category,search_text,title_search,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          input.title,
          input.summary,
          input.body,
          input.category,
          normalizeSearch([input.title, input.summary, input.body].join(' ')),
          normalizeSearch(input.title),
          now,
          now,
        );
      this.db
        .prepare(
          'INSERT INTO knowledge_create_keys(actor_id,request_id,digest,guide_id) VALUES(?,?,?,?)',
        )
        .run(actor, requestId, digest, id);
      this.event(id, actor, 1, 'created', 'draft', now);
      return { guide: this.get(id, 'staff'), replayed: false };
    });
  }
  update(id: string, actor: number, version: number, input: GuideInput): KnowledgeGuide {
    return this.atomic(() => {
      const current = this.get(id, 'staff');
      if (current.version !== version)
        throw new ApiError(
          409,
          'This guide changed elsewhere. Your draft has not been saved; load the current version before trying again.',
        );
      if (current.state === 'archived')
        throw new ApiError(409, 'Restore this guide to draft before editing it.');
      if (
        ['title', 'summary', 'body', 'category'].every(
          (key) => current[key as keyof GuideInput] === input[key as keyof GuideInput],
        )
      )
        return current;
      const now = new Date().toISOString();
      const changed = this.db
        .prepare(
          'UPDATE knowledge_guides SET title=?,summary=?,body=?,category=?,search_text=?,title_search=?,version=version+1,updated_at=? WHERE id=? AND version=?',
        )
        .run(
          input.title,
          input.summary,
          input.body,
          input.category,
          normalizeSearch([input.title, input.summary, input.body].join(' ')),
          normalizeSearch(input.title),
          now,
          id,
          version,
        );
      if (!changed.changes)
        throw new ApiError(409, 'This guide changed. Refresh it before saving.');
      this.event(id, actor, version + 1, 'edited', current.state, now);
      return this.get(id, 'staff');
    });
  }
  setState(id: string, actor: number, version: number, state: GuideState): KnowledgeGuide {
    return this.atomic(() => {
      const current = this.get(id, 'staff');
      if (current.version !== version)
        throw new ApiError(409, 'This guide changed. Refresh it before changing publication.');
      if (current.state === state) return current;
      if (current.state === 'archived' && state === 'published')
        throw new ApiError(409, 'Restore this guide to draft, review it, then publish it.');
      const now = new Date().toISOString();
      const changed = this.db
        .prepare(
          'UPDATE knowledge_guides SET state=?,version=version+1,updated_at=? WHERE id=? AND version=?',
        )
        .run(state, now, id, version);
      if (!changed.changes)
        throw new ApiError(409, 'This guide changed. Refresh it before changing publication.');
      this.event(id, actor, version + 1, 'state_changed', state, now);
      return this.get(id, 'staff');
    });
  }
  history(id: string): GuideEvent[] {
    this.get(id, 'staff');
    return this.db
      .prepare(
        'SELECT e.version,e.action,e.state,u.name AS actorName,e.created_at AS createdAt FROM knowledge_events e JOIN users u ON u.id=e.actor_id WHERE e.guide_id=? ORDER BY e.id DESC LIMIT 30',
      )
      .all(id) as unknown as GuideEvent[];
  }
}
export function seedKnowledgeDemo(db: DatabaseSync) {
  const entries: (GuideInput & { state: GuideState })[] = [
    {
      title: 'Connecting to campus Wi-Fi',
      summary: 'A short checklist for a laptop that cannot join the campus network.',
      category: 'it',
      state: 'published',
      body: '1. Check the network name against the campus IT notice. This fictional demo does not connect to a real campus network.\n\n2. Turn Wi-Fi off and on, then try connecting again. If your account was recently reset, enter the new password only in the official network sign-in screen.\n\n3. If the problem continues, submit an IT support request with the building, device type and the exact error message. Never include your password or recovery codes.',
    },
    {
      title: 'Reporting a room or equipment problem',
      summary:
        'Useful details to prepare when a projector, light or classroom device needs attention.',
      category: 'facilities',
      state: 'published',
      body: 'Give the building, room number and the equipment label if one is visible. Describe what happened and when you first noticed it.\n\nFor a projector, note whether the power light is on and whether the screen shows an error. You can check a loose cable if it is safe to do so; do not open the device.\n\nFor damaged electrical equipment, stop using it and contact the local facilities team. CampusDesk is a fictional portfolio demo, not an emergency reporting service.',
    },
    {
      title: 'Preparing an enrollment confirmation request',
      summary: 'What to include when asking student affairs for a confirmation document.',
      category: 'student_affairs',
      state: 'published',
      body: 'Before submitting a request, check the documents section of your official student portal. The required process depends on your institution.\n\nIn a support request, explain the type of confirmation you need, the purpose and your deadline. Do not upload identity documents or financial information into this portfolio demo.\n\nThe staff team can clarify the next step through a public reply on your request. All accounts, names and requests in this demo are fictional.',
    },
    {
      title: 'Internal review checklist for network changes',
      summary: 'An unpublished example for demonstrating the staff editorial workflow.',
      category: 'it',
      state: 'draft',
      body: 'This fictional editorial draft is visible only to staff. It is not a set of instructions for students. Review the network notice with the appropriate team before turning this draft into a published guide.',
    },
  ];
  for (const guide of entries) {
    const id = randomUUID(),
      now = new Date().toISOString();
    db.prepare(
      'INSERT INTO knowledge_guides(id,title,summary,body,category,state,search_text,title_search,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id,
      guide.title,
      guide.summary,
      guide.body,
      guide.category,
      guide.state,
      normalizeSearch([guide.title, guide.summary, guide.body].join(' ')),
      normalizeSearch(guide.title),
      now,
      now,
    );
    db.prepare(
      "INSERT INTO knowledge_events(guide_id,actor_id,version,action,state,created_at) VALUES(?,2,1,'created',?,?)",
    ).run(id, guide.state, now);
  }
}
