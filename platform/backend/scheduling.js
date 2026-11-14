export function overlaps(start, end, otherStart, otherEnd) {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  const c = new Date(otherStart).getTime();
  const d = new Date(otherEnd).getTime();
  return [a,b,c,d].every(Number.isFinite) && a < d && b > c;
}

export function validateScheduleWindow(startsAt, endsAt, now = Date.now()) {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Choose a valid start and end time.";
  if (start <= now) return "Interview slots must start in the future.";
  const duration = (end - start) / 60000;
  if (!Number.isInteger(duration) || duration < 5 || duration > 120) return "Interview duration must be a whole number between 5 and 120 minutes.";
  return null;
}

export function findFirstAvailableStart({ availability = [], busy = [], earliest, durationMinutes, stepMinutes = 5 }) {
  const earliestMs = new Date(earliest).getTime();
  const durationMs = Number(durationMinutes) * 60000;
  const stepMs = Number(stepMinutes) * 60000;
  if (![earliestMs, durationMs, stepMs].every(Number.isFinite) || durationMs <= 0 || stepMs <= 0) return null;

  const windows = availability
    .map((window) => ({ start: new Date(window.startsAt).getTime(), end: new Date(window.endsAt).getTime() }))
    .filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)
    .sort((a, b) => a.start - b.start);

  const occupied = busy
    .map((window) => ({ start: new Date(window.startsAt).getTime(), end: new Date(window.endsAt).getTime() }))
    .filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)
    .sort((a, b) => a.start - b.start);

  for (const window of windows) {
    let cursor = Math.max(window.start, earliestMs);
    while (cursor + durationMs <= window.end) {
      const collision = occupied.find((item) => cursor < item.end && cursor + durationMs > item.start);
      if (!collision) return new Date(cursor).toISOString();
      cursor = Math.max(cursor + stepMs, collision.end);
    }
  }
  return null;
}
