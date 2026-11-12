BEGIN;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS custom_answers JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_candidates_event_email_lower ON candidates(event_id,lower(email));
COMMIT;
