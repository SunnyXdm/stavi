CREATE TABLE IF NOT EXISTS _migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  title TEXT NOT NULL,
  agent_runtime TEXT NOT NULL CHECK (agent_runtime IN ('claude', 'codex')),
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'errored', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_server_lastactive
  ON sessions(server_id, last_active_at DESC);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  runtime_mode TEXT NOT NULL,
  interaction_mode TEXT NOT NULL,
  branch TEXT NOT NULL,
  worktree_path TEXT,
  model_selection TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_session ON threads(session_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  turn_id TEXT,
  streaming INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  sequence INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_seq ON messages(thread_id, sequence);
