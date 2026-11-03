import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
} from 'lucide-react';
import { api, RequestError } from './api';
import { categories, categoryLabels, type Category, type User } from '../shared/types';
import {
  guideStates,
  type GuideInput,
  type GuidePage,
  type GuideSummary,
  type GuideState,
  type GuideEvent,
  type KnowledgeGuide,
} from '../shared/knowledge';
import './knowledge.css';

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'The guide could not load. Please try again.';
const date = (value: string) =>
  new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
const emptyPage: GuidePage = { guides: [], total: 0, page: 1, pages: 1 };
type View =
  { kind: 'list' } | { kind: 'read'; id: string } | { kind: 'edit'; guide: KnowledgeGuide | null };
export function KnowledgeBase({
  user,
  onExpired,
  onRequest,
}: {
  user: User;
  onExpired: () => void;
  onRequest: () => void;
}) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [state, setState] = useState('');
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [data, setData] = useState(emptyPage);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const expire = useRef(onExpired);
  expire.current = onExpired;
  const staff = user.role === 'staff';
  useEffect(() => {
    if (view.kind !== 'list') return;
    let active = true;
    const abort = new AbortController();
    setLoading(true);
    setError('');
    setData(emptyPage);
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ page: String(page) });
      if (search.trim()) query.set('search', search.trim());
      if (category) query.set('category', category);
      if (state && staff) query.set('state', state);
      api<GuidePage>('/guides?' + query, { signal: abort.signal })
        .then((value) => {
          if (active) setData(value);
        })
        .catch((error) => {
          if (!active || error.name === 'AbortError') return;
          if (error instanceof RequestError && error.status === 401) expire.current();
          else setError(message(error));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
      abort.abort();
    };
  }, [search, category, state, page, revision, view.kind, staff]);
  const saved = (guide: KnowledgeGuide) => {
    setView({ kind: 'read', id: guide.id });
    setRevision((value) => value + 1);
    setNotice('Guide saved.');
  };
  if (view.kind === 'edit')
    return (
      <GuideEditor
        key={view.guide?.id ?? 'new'}
        initial={view.guide}
        onBack={() => setView(view.guide ? { kind: 'read', id: view.guide.id } : { kind: 'list' })}
        onSaved={saved}
        onExpired={onExpired}
      />
    );
  if (view.kind === 'read')
    return (
      <GuideReader
        key={view.id}
        id={view.id}
        staff={staff}
        onBack={() => {
          setView({ kind: 'list' });
          setNotice('');
        }}
        onEdit={(guide) => setView({ kind: 'edit', guide })}
        onExpired={onExpired}
        notice={notice}
      />
    );
  return (
    <section className="knowledge-library" aria-labelledby="knowledge-title">
      <div className="knowledge-heading">
        <div>
          <span className="eyebrow">A USEFUL PLACE TO START</span>
          <h1 id="knowledge-title">Answers for campus life.</h1>
          <p>
            Small guides from the support team. Find a next step, then ask for help if you need it.
          </p>
        </div>
        {staff ? (
          <button
            className="button primary"
            onClick={() => {
              setNotice('');
              setView({ kind: 'edit', guide: null });
            }}
          >
            <Plus size={18} />
            New guide
          </button>
        ) : (
          <button className="button secondary" onClick={onRequest}>
            Ask for help
            <ArrowUpRight size={17} />
          </button>
        )}
      </div>
      <div className="knowledge-banner">
        <span className="knowledge-mark">
          <BookOpen size={30} />
        </span>
        <div>
          <h2>
            {staff
              ? 'One clear guide can help many people.'
              : 'A little context. A clearer next step.'}
          </h2>
          <p>
            {staff
              ? 'Create a draft, review the details and publish when it is ready for students.'
              : 'Browse practical checklists for IT, rooms and equipment, and student services.'}
          </p>
        </div>
        <span className="knowledge-banner-note">
          CampusDesk
          <br />
          Knowledge library
        </span>
      </div>
      <div className="knowledge-filters">
        <label className="knowledge-search">
          <span>Search guides</span>
          <div>
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              maxLength={100}
              placeholder="Try Wi-Fi, room or enrollment"
            />
          </div>
        </label>
        <label>
          Guide service area
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All service areas</option>
            {categories.map((value) => (
              <option value={value} key={value}>
                {categoryLabels[value]}
              </option>
            ))}
          </select>
        </label>
        {staff && (
          <label>
            Publication state
            <select
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All states</option>
              {guideStates.map((value) => (
                <option key={value} value={value}>
                  {value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="text-button" onClick={() => setRevision((value) => value + 1)}>
          Refresh guides
        </button>
      </div>
      {error ? (
        <div role="alert" className="form-error">
          {error}
          <button className="text-button" onClick={() => setRevision((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="loading-block" role="status">
          Finding helpful guides…
        </div>
      ) : data.guides.length === 0 ? (
        <div className="knowledge-empty">
          <BookOpen size={32} />
          <h2>No guides match yet.</h2>
          <p>
            {staff
              ? 'Try another filter or create a guide for the next person who needs help.'
              : 'Try a different search or send a support request. The staff team can still help.'}
          </p>
        </div>
      ) : (
        <div className="knowledge-grid">
          {data.guides.map((guide) => (
            <button
              className="knowledge-card"
              key={guide.id}
              onClick={() => {
                setNotice('');
                setView({ kind: 'read', id: guide.id });
              }}
              aria-label={'Open guide: ' + guide.title}
            >
              <span className={'knowledge-category knowledge-category-' + guide.category}>
                {categoryLabels[guide.category]}
              </span>
              <h2>{guide.title}</h2>
              <p>{guide.summary}</p>
              <span className="knowledge-card-footer">
                <span>
                  {staff && (
                    <b className={'knowledge-state knowledge-state-' + guide.state}>
                      {guide.state}
                    </b>
                  )}
                  Updated {date(guide.updatedAt)}
                </span>
                <ArrowUpRight size={20} />
              </span>
            </button>
          ))}
        </div>
      )}
      {!loading && !error && (
        <div className="knowledge-pages">
          <span role="status">
            {data.total} {data.total === 1 ? 'guide' : 'guides'} · Page {data.page} of {data.pages}
          </span>
          <div>
            <button
              className="icon-button"
              aria-label="Previous guide page"
              disabled={data.page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft size={19} />
            </button>
            <button
              className="icon-button"
              aria-label="Next guide page"
              disabled={data.page >= data.pages}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight size={19} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
function GuideReader({
  id,
  staff,
  onBack,
  onEdit,
  onExpired,
  notice,
}: {
  id: string;
  staff: boolean;
  onBack: () => void;
  onEdit: (value: KnowledgeGuide) => void;
  onExpired: () => void;
  notice: string;
}) {
  const [guide, setGuide] = useState<KnowledgeGuide | null>(null),
    [events, setEvents] = useState<GuideEvent[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const busyRef = useRef(false),
    expire = useRef(onExpired),
    heading = useRef<HTMLHeadingElement>(null);
  expire.current = onExpired;
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setLoading(true);
    setError('');
    setGuide(null);
    setEvents([]);
    Promise.all([
      api<KnowledgeGuide>('/guides/' + id, { signal: abort.signal }),
      staff
        ? api<{ events: GuideEvent[] }>('/guides/' + id + '/history', { signal: abort.signal })
        : Promise.resolve({ events: [] }),
    ])
      .then(([value, history]) => {
        if (active) {
          setGuide(value);
          setEvents(history.events);
        }
      })
      .catch((error) => {
        if (active && error.name !== 'AbortError') {
          if (error instanceof RequestError && error.status === 401) expire.current();
          else setError(message(error));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [id, revision, staff]);
  useEffect(() => {
    if (guide && !loading) heading.current?.focus({ preventScroll: true });
  }, [guide?.id, loading]);
  async function change(state: GuideState) {
    if (!guide || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await api<KnowledgeGuide>('/guides/' + id + '/state', {
        method: 'POST',
        body: JSON.stringify({ version: guide.version, state }),
      });
      setGuide(value);
      setRevision((value) => value + 1);
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) expire.current();
      else setError(message(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="knowledge-reader">
      <div className="knowledge-reader-nav">
        <button className="text-button" onClick={onBack} disabled={busy}>
          <ArrowLeft size={17} />
          Back to library
        </button>
        <button
          className="text-button"
          onClick={() => setRevision((value) => value + 1)}
          disabled={busy}
        >
          Refresh guide
        </button>
      </div>
      {notice && (
        <p role="status" className="knowledge-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading ? (
        <div role="status" className="loading-block">
          Opening guide…
        </div>
      ) : (
        guide && (
          <>
            <div className="knowledge-article-heading">
              <span className={'knowledge-category knowledge-category-' + guide.category}>
                {categoryLabels[guide.category]}
              </span>
              <h1 ref={heading} tabIndex={-1}>
                {guide.title}
              </h1>
              <p>{guide.summary}</p>
              <small>
                Updated {date(guide.updatedAt)}
                {staff ? ' · Version ' + guide.version : ''}
              </small>
            </div>
            {staff && (
              <div className="knowledge-editorial">
                <div>
                  <b className={'knowledge-state knowledge-state-' + guide.state}>{guide.state}</b>
                  <span>
                    {guide.state === 'published'
                      ? 'Students can read this guide.'
                      : guide.state === 'draft'
                        ? 'Only staff can read this draft.'
                        : 'Archived guides are hidden from students.'}
                  </span>
                </div>
                <div className="knowledge-actions">
                  <button
                    className="button secondary compact"
                    disabled={busy || guide.state === 'archived'}
                    onClick={() => onEdit(guide)}
                  >
                    Edit guide
                  </button>
                  {guide.state === 'draft' && (
                    <button
                      className="button primary compact"
                      disabled={busy}
                      onClick={() => void change('published')}
                    >
                      Publish guide
                    </button>
                  )}
                  {guide.state === 'published' && (
                    <button
                      className="button secondary compact"
                      disabled={busy}
                      onClick={() => void change('draft')}
                    >
                      Move to draft
                    </button>
                  )}
                  {guide.state !== 'archived' ? (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void change('archived')}
                    >
                      Archive guide
                    </button>
                  ) : (
                    <button
                      className="button secondary compact"
                      disabled={busy}
                      onClick={() => void change('draft')}
                    >
                      Restore draft
                    </button>
                  )}
                </div>
              </div>
            )}
            <article className="knowledge-body" aria-label="Guide content">
              {guide.body}
            </article>
            {staff && (
              <section className="knowledge-history" aria-label="Guide activity">
                <h2>Editorial activity</h2>
                <p>The latest 30 changes to content or publication.</p>
                <ol>
                  {events.map((event) => (
                    <li key={event.version}>
                      <b>
                        v{event.version} ·{' '}
                        {event.action === 'created'
                          ? 'Created'
                          : event.action === 'edited'
                            ? 'Content updated'
                            : 'Publication changed'}{' '}
                        · {event.state}
                      </b>
                      <span>
                        {event.actorName} · {date(event.createdAt)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )
      )}
    </section>
  );
}
function GuideEditor({
  initial,
  onBack,
  onSaved,
  onExpired,
}: {
  initial: KnowledgeGuide | null;
  onBack: () => void;
  onSaved: (value: KnowledgeGuide) => void;
  onExpired: () => void;
}) {
  const [current, setCurrent] = useState(initial);
  const [title, setTitle] = useState(initial?.title ?? ''),
    [summary, setSummary] = useState(initial?.summary ?? ''),
    [body, setBody] = useState(initial?.body ?? ''),
    [category, setCategory] = useState<Category>(initial?.category ?? 'it');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<KnowledgeGuide | null>(null);
  const pending = useRef(false),
    requestId = useRef(crypto.randomUUID());
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending.current || current?.state === 'archived') return;
    pending.current = true;
    setBusy(true);
    setError('');
    setConflict(false);
    setLatest(null);
    const input: GuideInput = { title, summary, body, category };
    try {
      const result = await api<KnowledgeGuide>('/guides' + (current ? '/' + current.id : ''), {
        method: current ? 'PATCH' : 'POST',
        body: JSON.stringify(
          current
            ? { ...input, version: current.version }
            : { ...input, requestId: requestId.current },
        ),
      });
      onSaved(result);
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) onExpired();
      else {
        setError(message(error));
        setConflict(error instanceof RequestError && error.status === 409);
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function compare() {
    if (!current || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      setLatest(await api<KnowledgeGuide>('/guides/' + current.id));
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) onExpired();
      else setError(message(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function replace() {
    if (!latest) return;
    setCurrent(latest);
    setTitle(latest.title);
    setSummary(latest.summary);
    setBody(latest.body);
    setCategory(latest.category);
    setLatest(null);
    setConflict(false);
    setError('');
  }
  return (
    <section className="knowledge-edit">
      <button className="text-button" onClick={onBack} disabled={busy}>
        <ArrowLeft size={17} />
        Back without saving
      </button>
      <div className="knowledge-edit-heading">
        <span className="eyebrow">A CLEARER NEXT STEP FOR SOMEONE</span>
        <h1>{current ? 'Edit guide' : 'Write a helpful guide.'}</h1>
        <p>
          {current?.state === 'archived'
            ? 'This guide was archived. Return to the guide and restore it to draft before editing.'
            : current?.state === 'published'
              ? 'Saving updates the published guide students can read.'
              : 'New guides are saved as drafts. Review them before publishing.'}
        </p>
      </div>
      <form onSubmit={save} aria-busy={busy}>
        <fieldset disabled={busy || current?.state === 'archived'}>
          <label>
            Guide title
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={5}
              maxLength={120}
              placeholder="Give the guide a clear, practical title"
            />
          </label>
          <label>
            Guide service area
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {categories.map((value) => (
                <option value={value} key={value}>
                  {categoryLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Short summary
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              required
              minLength={20}
              maxLength={240}
              rows={2}
            />
            <small>{summary.length}/240 · Tell people when this guide is useful.</small>
          </label>
          <label>
            Guide content
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              minLength={40}
              maxLength={8000}
              rows={12}
            />
            <small>
              {body.length}/8000 · Plain text and line breaks. Keep passwords and private student
              information out.
            </small>
          </label>
        </fieldset>
        {error && (
          <div className="form-error" role="alert">
            {error}
            {conflict && current && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void compare()}
              >
                Compare current version
              </button>
            )}
          </div>
        )}
        {latest && (
          <section className="knowledge-conflict" aria-label="Current saved version">
            <h2>Current version · v{latest.version}</h2>
            <h3>{latest.title}</h3>
            <p>{latest.summary}</p>
            <div>{latest.body}</div>
            <p>
              Your unsaved text is still in the form above. This button replaces it with the current
              saved version.
            </p>
            <button className="button secondary" type="button" disabled={busy} onClick={replace}>
              Replace form with current version
            </button>
          </section>
        )}
        <div className="knowledge-save-actions">
          <button className="button secondary" type="button" onClick={onBack} disabled={busy}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || current?.state === 'archived'}>
            {busy
              ? 'Saving…'
              : current?.state === 'published'
                ? 'Save published changes'
                : 'Save draft'}
          </button>
        </div>
      </form>
    </section>
  );
}
export function RelatedGuides({ category, query }: { category: Category; query: string }) {
  const [guides, setGuides] = useState<GuideSummary[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setLoading(true);
    setGuides([]);
    setError('');
    const timer = setTimeout(() => {
      const q = new URLSearchParams({ category, search: query });
      api<{ guides: GuideSummary[] }>('/guides/suggestions?' + q, { signal: abort.signal })
        .then((value) => {
          if (active) setGuides(value.guides);
        })
        .catch((error) => {
          if (active && error.name !== 'AbortError')
            setError('Guides are unavailable right now. You can still submit your request.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      abort.abort();
    };
  }, [category, query]);
  return (
    <aside className="related-guides" aria-label="Suggested guides">
      <div className="related-heading">
        <BookOpen size={19} />
        <h3>A guide might help</h3>
      </div>
      <p>
        A few checklists for {categoryLabels[category].toLowerCase()}. You can still ask for help
        below.
      </p>
      {loading ? (
        <small role="status">Looking for guides…</small>
      ) : error ? (
        <small role="status">{error}</small>
      ) : guides.length === 0 ? (
        <small>No guides in this service area yet.</small>
      ) : (
        guides.map((guide) => <RelatedGuide key={guide.id} guide={guide} />)
      )}
    </aside>
  );
}
function RelatedGuide({ guide }: { guide: GuideSummary }) {
  const [open, setOpen] = useState(false),
    [detail, setDetail] = useState<KnowledgeGuide | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    const abort = new AbortController();
    setDetail(null);
    setError('');
    api<KnowledgeGuide>('/guides/' + guide.id, { signal: abort.signal })
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((error) => {
        if (active && error.name !== 'AbortError')
          setError('This guide is unavailable. You can continue with your request.');
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [open, guide.id]);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{guide.title}</summary>
      {open && (
        <div>
          {error ? (
            <p role="status">{error}</p>
          ) : detail ? (
            <p>{detail.body}</p>
          ) : (
            <small role="status">Opening guide…</small>
          )}
        </div>
      )}
    </details>
  );
}
