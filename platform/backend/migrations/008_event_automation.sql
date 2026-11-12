-- RecruitFlow Phase 2 event automation (migration 008)
CREATE TABLE IF NOT EXISTS interview_slots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES recruitment_events(id) ON DELETE CASCADE,
 candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
 panel_id uuid NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'scheduled' CHECK(status IN('scheduled','confirmed','completed','cancelled','no_show')),
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at),
 UNIQUE(event_id,candidate_id,starts_at)
);
CREATE INDEX IF NOT EXISTS interview_slots_panel_time_idx ON interview_slots(event_id,panel_id,starts_at,ends_at) WHERE status IN('scheduled','confirmed');
CREATE INDEX IF NOT EXISTS interview_slots_candidate_idx ON interview_slots(event_id,candidate_id,starts_at DESC);
CREATE TABLE IF NOT EXISTS event_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES recruitment_events(id) ON DELETE CASCADE,
 user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
 title varchar(180) NOT NULL,
 message varchar(2000) NOT NULL,
 channel varchar(20) NOT NULL DEFAULT 'in_app' CHECK(channel IN('in_app','email','sms','whatsapp')),
 status varchar(20) NOT NULL DEFAULT 'queued' CHECK(status IN('queued','sent','failed','read')),
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz
);
CREATE INDEX IF NOT EXISTS event_notifications_user_idx ON event_notifications(event_id,user_id,created_at DESC);
