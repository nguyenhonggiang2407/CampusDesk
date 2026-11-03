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
