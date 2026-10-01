CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(60) UNIQUE NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(40) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY,
  candidate_id VARCHAR(60) UNIQUE NOT NULL,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(160) DEFAULT '',
  phone VARCHAR(40) DEFAULT '',
  branch VARCHAR(100) DEFAULT '',
  year VARCHAR(40) DEFAULT '',
  skills TEXT DEFAULT '',
  choices JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(40) NOT NULL DEFAULT 'Registered',
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS panels (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(100) UNIQUE NOT NULL,
  interviewer_user_id INTEGER REFERENCES users(id),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS interviews (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  panel_id INTEGER REFERENCES panels(id),
  domain VARCHAR(100) NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  technical INTEGER,
  communication INTEGER,
  problem_solving INTEGER,
  domain_knowledge INTEGER,
  total INTEGER,
  feedback TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  type VARCHAR(60) NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS allocations (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER UNIQUE NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  domain VARCHAR(100),
  score INTEGER,
  choice_priority INTEGER,
  status VARCHAR(40) NOT NULL,
  finalized_at TIMESTAMPTZ
);
