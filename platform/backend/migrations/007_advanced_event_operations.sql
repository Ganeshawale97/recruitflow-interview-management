-- RecruitFlow advanced operations foundation (migration 007)
-- All operational records are event-scoped; event ownership is resolved through recruitment_events.organization_id.
CREATE TABLE IF NOT EXISTS event_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES recruitment_events(id) ON DELETE CASCADE,
 title varchar(180) NOT NULL, description text NOT NULL DEFAULT '', status varchar(20) NOT NULL DEFAULT 'todo' CHECK(status IN('todo','in_progress','blocked','done','cancelled')),
 priority varchar(12) NOT NULL DEFAULT 'normal' CHECK(priority IN('low','normal','high','urgent')),
 assigned_to uuid REFERENCES users(id) ON DELETE SET NULL, due_at timestamptz, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_tasks_event_status_idx ON event_tasks(event_id,status,due_at);
CREATE TABLE IF NOT EXISTS event_incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES recruitment_events(id) ON DELETE CASCADE,
 title varchar(180) NOT NULL, description text NOT NULL DEFAULT '', category varchar(40) NOT NULL DEFAULT 'other',
 severity varchar(12) NOT NULL DEFAULT 'medium' CHECK(severity IN('low','medium','high','critical')),
 status varchar(20) NOT NULL DEFAULT 'open' CHECK(status IN('open','investigating','resolved','closed')),
 reported_by uuid REFERENCES users(id) ON DELETE SET NULL, assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
 resolution text, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_incidents_event_status_idx ON event_incidents(event_id,status,severity,created_at DESC);
CREATE TABLE IF NOT EXISTS volunteer_attendance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES recruitment_events(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, check_in_at timestamptz NOT NULL DEFAULT now(),
 check_out_at timestamptz, note varchar(500), recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS volunteer_one_open_shift_idx ON volunteer_attendance(event_id,user_id) WHERE check_out_at IS NULL;
CREATE TABLE IF NOT EXISTS event_waitlist (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES recruitment_events(id) ON DELETE CASCADE,
 candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, position integer NOT NULL CHECK(position>0),
 status varchar(20) NOT NULL DEFAULT 'waiting' CHECK(status IN('waiting','offered','accepted','declined','expired','removed')),
 offered_at timestamptz, responded_at timestamptz, note varchar(500),
 created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,candidate_id), UNIQUE(event_id,position)
);
CREATE INDEX IF NOT EXISTS event_waitlist_order_idx ON event_waitlist(event_id,status,position);
CREATE TABLE IF NOT EXISTS candidate_feedback (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES recruitment_events(id) ON DELETE CASCADE,
 candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL, rating smallint CHECK(rating BETWEEN 1 AND 5),
 category varchar(40) NOT NULL DEFAULT 'overall', comments varchar(3000) NOT NULL DEFAULT '',
 is_anonymous boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_feedback_event_idx ON candidate_feedback(event_id,created_at DESC);
CREATE TABLE IF NOT EXISTS interview_question_bank (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES recruitment_events(id) ON DELETE CASCADE,
 domain_id uuid REFERENCES domains(id) ON DELETE SET NULL, question text NOT NULL,
 difficulty varchar(12) NOT NULL DEFAULT 'medium' CHECK(difficulty IN('easy','medium','hard')),
 question_type varchar(30) NOT NULL DEFAULT 'technical', created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interview_question_bank_event_domain_idx ON interview_question_bank(event_id,domain_id,active);
CREATE TABLE IF NOT EXISTS candidate_passes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES recruitment_events(id) ON DELETE CASCADE,
 candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, pass_code varchar(80) NOT NULL UNIQUE,
 issued_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, UNIQUE(event_id,candidate_id)
);
