BEGIN;
ALTER TABLE recruitment_events ADD COLUMN IF NOT EXISTS description VARCHAR(2000);
ALTER TABLE recruitment_events ADD COLUMN IF NOT EXISTS registration_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_events_org_created ON recruitment_events(organization_id,created_at DESC);
COMMIT;
