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
