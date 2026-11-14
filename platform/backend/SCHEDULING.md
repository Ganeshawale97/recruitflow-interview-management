# Advanced interview scheduling

RecruitFlow keeps all scheduling records scoped to a recruitment event. Scheduling uses the existing `interview_slots` and `event_notifications` tables plus migration 010.

## Database setup

The API creates the new table/columns lazily on first scheduling use. For a managed deployment, apply the migration explicitly:

```bash
cd platform/backend
psql "$DATABASE_URL" -f migrations/010_advanced_interview_scheduling.sql
```

## Interviewer availability

Interviewers can open their Interviewer workspace, select an event and add future availability windows. Event administrators can also add or remove windows from Operations Hub → Scheduling.

- A window must be in the future and no longer than 12 hours.
- Windows for the same interviewer cannot overlap.
- The interviewer must be active and assigned to an active panel in the selected event.
- Interviewers can remove only their own windows; event scheduling administrators can manage event availability.

## Booking rules

- A booking must match one of the candidate's remaining domain preferences.
- The panel must be active and have an active interviewer assignment.
- The selected interviewer must have an availability window covering the entire booking. Organizers may select a specific assigned interviewer or let RecruitFlow choose an available interviewer.
- Interview duration is 5–120 minutes.
- One active scheduled/confirmed booking is allowed per candidate at a time.
- Panel, interviewer and candidate conflicts are checked in a transaction. An event-level PostgreSQL advisory lock serializes competing booking writes.
- A booking stores the assigned interviewer so later assignment changes do not silently rewrite the historical booking.
- Rescheduling rechecks availability and all conflict rules. Cancelling releases the booking window.

## API routes

All routes below require a valid RecruitFlow session and event authorization, except the public candidate confirmation endpoint which verifies Candidate ID and registered email.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/events/:id/automation/availability` | List availability windows; interviewers see their own |
| POST | `/api/events/:id/automation/availability` | Add an availability window |
| DELETE | `/api/events/:id/automation/availability/:availabilityId` | Remove an availability window |
| GET | `/api/events/:id/automation/slots` | List scheduled bookings |
| POST | `/api/events/:id/automation/slots` | Allocate a candidate to a time slot |
| POST | `/api/events/:id/automation/slots/:slotId/reschedule` | Reschedule a booking |
| PATCH | `/api/events/:id/automation/slots/:slotId` | Confirm, cancel, complete or mark no-show |
| GET | `/api/events/:id/automation/calendar?from=ISO&to=ISO` | Read calendar bookings and availability |
| POST | `/api/events/:id/automation/auto-schedule` | Allocate candidates using their highest-priority remaining domain preference |
| GET | `/api/events/:id/automation/notifications` | List event in-app notices |
| PATCH | `/api/events/:id/automation/notifications/:notificationId/read` | Mark the signed-in user's notice as read |
| POST | `/api/public/track/confirm-slot` | Candidate confirms a future booking after identity verification |

## Notifications and candidate tracking

Scheduling, organizer confirmation, candidate confirmation, rescheduling and cancellation create in-app notices for the candidate and assigned interviewer. Candidates can confirm a future scheduled booking from Track Application after verifying their Candidate ID and registered email. The public tracking and confirmation endpoints share a rate limiter. No email, SMS or WhatsApp delivery is invoked by these scheduling routes.

## Verification

Run the pure scheduling helper tests:

```bash
cd platform/backend
npm test
```

The tests cover interval boundaries, duration validation, earliest-fit allocation, conflict skipping and unavailable windows. The backend CI workflow runs these tests alongside the server syntax check.
