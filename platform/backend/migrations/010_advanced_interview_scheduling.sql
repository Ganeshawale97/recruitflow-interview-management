-- RecruitFlow advanced interview scheduling (migration 010)
ALTER TABLE interview_slots
  ADD COLUMN IF NOT EXISTS interviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS interview_slots_interviewer_time_idx
  ON interview_slots(event_id, interviewer_id, starts_at, ends_at)
  WHERE status IN ('scheduled','confirmed');

CREATE TABLE IF NOT EXISTS interviewer_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES recruitment_events(id) ON DELETE CASCADE,
  interviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  note varchar(500) NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS interviewer_availability_event_time_idx
  ON interviewer_availability(event_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS interviewer_availability_user_time_idx
  ON interviewer_availability(event_id, interviewer_id, starts_at, ends_at);
