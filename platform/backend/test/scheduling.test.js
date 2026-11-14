import test from "node:test";
import assert from "node:assert/strict";
import { findFirstAvailableStart, overlaps, validateScheduleWindow } from "../scheduling.js";

const at = (value) => new Date(value).toISOString();

test("adjacent bookings do not overlap", () => {
  assert.equal(overlaps("2026-11-14T09:00:00Z", "2026-11-14T09:15:00Z", "2026-11-14T09:15:00Z", "2026-11-14T09:30:00Z"), false);
});

test("intersecting bookings overlap", () => {
  assert.equal(overlaps("2026-11-14T09:00:00Z", "2026-11-14T09:20:00Z", "2026-11-14T09:15:00Z", "2026-11-14T09:30:00Z"), true);
});

test("schedule window requires a future duration between 5 and 120 minutes", () => {
  const now = Date.parse("2026-11-14T08:00:00Z");
  assert.equal(validateScheduleWindow("2026-11-14T09:00:00Z", "2026-11-14T09:15:00Z", now), null);
  assert.match(validateScheduleWindow("2026-11-14T07:00:00Z", "2026-11-14T07:15:00Z", now), /future/);
  assert.match(validateScheduleWindow("2026-11-14T09:00:00Z", "2026-11-14T09:03:00Z", now), /5 and 120/);
  assert.match(validateScheduleWindow("2026-11-14T09:00:00Z", "2026-11-14T11:30:00Z", now), /5 and 120/);
  assert.match(validateScheduleWindow("not-a-date", "2026-11-14T09:15:00Z", now), /valid/);
});

test("finds the earliest available time after an existing conflict", () => {
  const result = findFirstAvailableStart({
    availability: [{ startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T11:00:00Z" }],
    busy: [{ startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T09:30:00Z" }],
    earliest: "2026-11-14T09:00:00Z",
    durationMinutes: 20
  });
  assert.equal(result, at("2026-11-14T09:30:00Z"));
});

test("does not place a booking outside an availability window", () => {
  assert.equal(findFirstAvailableStart({
    availability: [{ startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T09:10:00Z" }],
    earliest: "2026-11-14T09:00:00Z",
    durationMinutes: 15
  }), null);
});

test("checks later availability windows after an earlier window is full", () => {
  const result = findFirstAvailableStart({
    availability: [
      { startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T09:20:00Z" },
      { startsAt: "2026-11-14T10:00:00Z", endsAt: "2026-11-14T11:00:00Z" }
    ],
    earliest: "2026-11-14T09:00:00Z",
    durationMinutes: 30
  });
  assert.equal(result, at("2026-11-14T10:00:00Z"));
});

test("skips consecutive busy intervals before allocating a slot", () => {
  const result = findFirstAvailableStart({
    availability: [{ startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T11:00:00Z" }],
    busy: [
      { startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T09:20:00Z" },
      { startsAt: "2026-11-14T09:25:00Z", endsAt: "2026-11-14T09:45:00Z" }
    ],
    earliest: "2026-11-14T09:00:00Z",
    durationMinutes: 20
  });
  assert.equal(result, at("2026-11-14T09:45:00Z"));
});

test("returns no slot when the requested start is after all availability", () => {
  assert.equal(findFirstAvailableStart({
    availability: [{ startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T10:00:00Z" }],
    earliest: "2026-11-14T10:01:00Z",
    durationMinutes: 15
  }), null);
});

test("selects the earliest fit across unordered availability windows", () => {
  const result = findFirstAvailableStart({
    availability: [
      { startsAt: "2026-11-14T11:00:00Z", endsAt: "2026-11-14T12:00:00Z" },
      { startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T10:00:00Z" }
    ],
    earliest: "2026-11-14T09:30:00Z",
    durationMinutes: 15
  });
  assert.equal(result, at("2026-11-14T09:30:00Z"));
});

test("rejects fractional interview durations", () => {
  assert.match(validateScheduleWindow("2026-11-14T09:00:00Z", "2026-11-14T09:15:30Z", Date.parse("2026-11-14T08:00:00Z")), /whole number/);
});

test("rejects fractional duration and step sizes in the slot finder", () => {
  const availability = [{ startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T10:00:00Z" }];
  const base = { availability, earliest: "2026-11-14T09:00:00Z" };
  assert.equal(findFirstAvailableStart({ ...base, durationMinutes: 15.5 }), null);
  assert.equal(findFirstAvailableStart({ ...base, durationMinutes: 15, stepMinutes: 2.5 }), null);
});

test("returns no slot for invalid availability timestamps", () => {
  assert.equal(findFirstAvailableStart({
    availability: [{ startsAt: "not-a-date", endsAt: "2026-11-14T10:00:00Z" }],
    earliest: "2026-11-14T09:00:00Z",
    durationMinutes: 15
  }), null);
});

test("accepts the minimum and maximum supported interview durations", () => {
  const now = Date.parse("2026-11-14T08:00:00Z");
  assert.equal(validateScheduleWindow("2026-11-14T09:00:00Z", "2026-11-14T09:05:00Z", now), null);
  assert.equal(validateScheduleWindow("2026-11-14T09:00:00Z", "2026-11-14T11:00:00Z", now), null);
});

test("rejects reversed and out-of-range interview windows", () => {
  const now = Date.parse("2026-11-14T08:00:00Z");
  assert.match(validateScheduleWindow("2026-11-14T09:10:00Z", "2026-11-14T09:00:00Z", now), /5 and 120/);
  assert.match(validateScheduleWindow("2026-11-14T09:00:00Z", "2026-11-14T09:04:00Z", now), /5 and 120/);
  assert.match(validateScheduleWindow("2026-11-14T09:00:00Z", "2026-11-14T11:01:00Z", now), /5 and 120/);
});

test("rejects a slot that starts exactly at the current instant", () => {
  const now = Date.parse("2026-11-14T08:00:00Z");
  assert.match(validateScheduleWindow("2026-11-14T08:00:00Z", "2026-11-14T08:15:00Z", now), /future/);
});

test("invalid intervals never overlap", () => {
  assert.equal(overlaps("not-a-date", "2026-11-14T09:15:00Z", "2026-11-14T09:00:00Z", "2026-11-14T09:30:00Z"), false);
  assert.equal(overlaps("2026-11-14T09:30:00Z", "2026-11-14T09:00:00Z", "2026-11-14T09:00:00Z", "2026-11-14T09:30:00Z"), false);
});

test("slot finder ignores malformed and reversed availability windows", () => {
  const result = findFirstAvailableStart({
    availability: [
      { startsAt: "not-a-date", endsAt: "2026-11-14T10:00:00Z" },
      { startsAt: "2026-11-14T10:00:00Z", endsAt: "2026-11-14T09:00:00Z" },
      { startsAt: "2026-11-14T11:00:00Z", endsAt: "2026-11-14T12:00:00Z" }
    ],
    earliest: "2026-11-14T09:00:00Z",
    durationMinutes: 15
  });
  assert.equal(result, at("2026-11-14T11:00:00Z"));
});

test("slot finder ignores malformed busy intervals without blocking valid capacity", () => {
  const result = findFirstAvailableStart({
    availability: [{ startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T10:00:00Z" }],
    busy: [
      { startsAt: "not-a-date", endsAt: "2026-11-14T09:30:00Z" },
      { startsAt: "2026-11-14T09:45:00Z", endsAt: "2026-11-14T09:30:00Z" }
    ],
    earliest: "2026-11-14T09:00:00Z",
    durationMinutes: 15
  });
  assert.equal(result, at("2026-11-14T09:00:00Z"));
});

test("slot finder rejects zero and negative step sizes", () => {
  const base = {
    availability: [{ startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T10:00:00Z" }],
    earliest: "2026-11-14T09:00:00Z",
    durationMinutes: 15
  };
  assert.equal(findFirstAvailableStart({ ...base, stepMinutes: 0 }), null);
  assert.equal(findFirstAvailableStart({ ...base, stepMinutes: -5 }), null);
});

test("slot finder rejects invalid earliest timestamps", () => {
  assert.equal(findFirstAvailableStart({
    availability: [{ startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T10:00:00Z" }],
    earliest: "invalid",
    durationMinutes: 15
  }), null);
});
