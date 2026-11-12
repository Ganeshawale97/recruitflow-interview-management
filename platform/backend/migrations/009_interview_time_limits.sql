-- Optional target duration for interviewer guidance only.
-- Exceeding this value never stops or completes an interview.
ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS expected_duration_minutes INTEGER
  CHECK (expected_duration_minutes IS NULL OR expected_duration_minutes BETWEEN 1 AND 180);
