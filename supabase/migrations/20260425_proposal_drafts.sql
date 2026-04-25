-- proposal_drafts table
-- Run this once in Supabase SQL editor (or via supabase db push)

CREATE TABLE IF NOT EXISTS proposal_drafts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL DEFAULT 'Untitled Draft',
  acronym     TEXT,
  call_id     TEXT,
  phase       TEXT        NOT NULL DEFAULT 'setup',
  sections_complete INTEGER NOT NULL DEFAULT 0,
  data        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proposal_drafts_user_id_idx ON proposal_drafts (user_id);
CREATE INDEX IF NOT EXISTS proposal_drafts_updated_idx  ON proposal_drafts (user_id, updated_at DESC);

-- Row-level security: each user can only access their own drafts
ALTER TABLE proposal_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own drafts" ON proposal_drafts;
CREATE POLICY "Users manage own drafts"
  ON proposal_drafts
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_proposal_draft_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposal_drafts_updated ON proposal_drafts;
CREATE TRIGGER proposal_drafts_updated
  BEFORE UPDATE ON proposal_drafts
  FOR EACH ROW EXECUTE FUNCTION update_proposal_draft_timestamp();
