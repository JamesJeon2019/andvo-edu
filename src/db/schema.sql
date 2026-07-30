-- Lessons table. Full lesson object lives in `data` (JSONB); the other
-- columns are duplicated out of `data` only to support future list/filter
-- screens without deserializing every row.
CREATE TABLE IF NOT EXISTS lessons (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL,
  subject TEXT,
  level TEXT,
  mode TEXT,           -- 'ai' eller 'material'
  title TEXT,
  status TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'archived'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schools: single shared login per school. All teachers at a school share
-- this one account and see each other's lessons; isolation is only between
-- different schools (see school_id on lessons, added separately).
CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
