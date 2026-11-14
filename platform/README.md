# RecruitFlow Platform — Phase 1.7

React + TypeScript frontend and Express/PostgreSQL API. Legacy HTML prototypes remain preserved.

## Run frontend
```powershell
cd platform
npm install
npm run dev
```
Open http://localhost:5173.

## Run backend
```powershell
cd platform/backend
npm install
npm run dev
```
Keep your existing local `.env`. Never commit it or share its secrets.

## Database
The Phase 1 schema already includes recruitment_events, event_users, domains, panels and panel_assignments. If you have not applied it yet:
```powershell
psql -U postgres -d recruitflow -f schema.sql
```
If you applied schema.sql earlier, no migration is required for Phase 1.2.

## Phase 1.7 — automatic panel dispatch
- After check-in, RecruitFlow finds the next available panel matching the candidate's next uncompleted domain preference and creates a locked panel assignment.
- First interviews are routed to the W1 volunteer; subsequent interviews are routed to the W2 volunteer.
- Volunteers receive live dashboard notifications (5-second refresh) with participant, domain and assigned panel details.
- Volunteers confirm **Confirm Participant Sent** after guiding the participant to the assigned panel.
- Interviewers can start only after the volunteer confirms dispatch; the interviewer does not choose the panel.
- After an interview is completed, the candidate returns to Waiting Room 2 when preferences remain and the next eligible panel dispatch is created automatically.
- Dispatch records are created automatically in PostgreSQL on first use; no manual database migration or reset is required.

## Phase 1.6 features
- Selection review ranks candidates by average completed interview score and displays interview progress, best score and strongest domain.
- Advisory recommendation bands: Shortlist for review (average 28+/40), Committee review (24–27.99/40), Further review (below 24/40), or Pending interviews.
- Event analytics show candidate pipeline totals, recommendation counts and domain-level average scores.
- Downloadable CSV candidate evaluation report for committee records.
- Recommendations do not automatically select or reject candidates; final decisions remain with the selection committee.
- No database migration required.

## Phase 1.5 features
- Interview execution follows the candidate's ordered domain preferences (up to four); out-of-order panel starts are rejected.
- After each completed interview, the candidate automatically returns to Waiting Room 2 when another preference remains; otherwise the candidate is marked interviewed.
- Candidate progress endpoint reports each preference, interview status, panel, scores and feedback.
- Final domain ranking uses highest completed interview score, with candidate preference order as the tie-breaker.
- Live Operations includes a domain-progress view and informs operators of the next required domain.

## Phase 1.4 features
- Live operations queue grouped into Registered, Waiting Room 1, Waiting Room 2, Interviewing and Interviewed.
- Entry volunteers check candidates in; W1/W2 volunteers move candidates between waiting rooms.
- Assigned interviewers can start interviews from Waiting Room 2 and submit four scored categories (0–10 each) plus feedback.
- Interview start/complete operations are transaction-backed, enforce panel assignments for interviewers, prevent duplicate active interviews and write audit entries for check-in and room movement.
- Candidate status and interview score records are stored in PostgreSQL.

## Phase 1.3 features
- Public event registration at `http://localhost:5173/?register=<event-slug>` for events in `open` or `live` status.
- Candidate form with academic details, skills, HTTPS profile links and up to four ordered domain preferences.
- Unique Candidate ID generation and application tracking by Candidate ID plus registered email.
- Admin/Registration Volunteer candidate list API with search and status filters.
- Candidate and preference records stored transactionally in PostgreSQL using the existing schema.

## Phase 1.2 features
- Create recruitment events with unique slugs and optional start/end dates.
- Automatically provision the 11 default domains and 11 interview panels per event.
- Change event lifecycle status (draft, open, live, completed, archived).
- Manage global staff accounts, activate/deactivate users and update roles.
- Add existing active users to an event team with event-specific role.
- Assign one active interviewer to each panel; prevents assigning one interviewer to multiple active panels.
- Server-side authentication and role authorization for management endpoints.

## Important
- Only Admin/Super Admin can create events and manage users/team/panel assignments.
- The frontend hides restricted modules, but the API enforces permissions too.
- Candidate registration, interview execution and audit-event history are separate upcoming phases.

## Phase 3 advanced event operations foundation
Migration 007 adds event-scoped task management, incident tracking, volunteer attendance, candidate waitlists, interviewer question banks, and digital pass records. Apply it once to the existing RecruitFlow database after pulling the branch:
```powershell
cd platform\backend
psql -U postgres -d recruitflow -f migrations\007_advanced_event_operations.sql
```
The Operations Hub is available inside an event dashboard for authorized administrators. Its APIs are event-scoped and use the existing event membership boundary. Current implemented tools: task creation/status tracking, incident reporting/status tracking, volunteer check-in/check-out, candidate waitlist management, interviewer question bank, digital pass issuance, and operational summary metrics. External AI providers, SMS/WhatsApp delivery, email delivery, and public candidate self-service flows require separate provider credentials and dedicated integration work; they are not represented as active until configured.

## Event automation upgrade (migration 008)
Apply the new scheduling and notification tables after migration 007:
```powershell
cd platform\backend
psql -U postgres -d recruitflow -f migrations\008_event_automation.sql
```
The Operations Hub automation tabs provide:
- QR pass-code check-in (issue a candidate digital pass first; a USB/Bluetooth QR scanner that types the code can be used).
- Manual interview slot booking with panel-overlap prevention.
- Suggested automatic scheduling for candidates' first-choice domain panels; review generated slots before communicating them.
- Panel workload snapshot (queued, interviewing, upcoming bookings).
- In-app event notifications generated by check-in and scheduling.
Email, SMS and WhatsApp delivery are not active without configured provider credentials. Browser camera QR scanning is not included; use a QR scanner that enters the decoded pass code.

## Automatic candidate QR entry passes
Every successful public registration now creates a unique candidate pass code and QR image. The registration success screen displays the QR image and a download button. Email delivery is intentionally disabled; participants download the QR pass from the confirmation page.
No SMTP credentials or email provider are needed. Participants see and download the QR pass directly from the registration confirmation page. Existing registrations are not retroactively emailed by this change.


## Advanced interview scheduling (migration 010)
Apply `platform/backend/migrations/010_advanced_interview_scheduling.sql` to managed databases. The API also creates the new availability table and booking columns on first scheduling use. Interviewers can add their own availability from the Interviewer workspace; event administrators can manage windows and allocate candidates from Operations Hub → Scheduling. Booking allocation checks candidate preference, interviewer availability, panel/interviewer/candidate conflicts and serializes writes per event. Reschedule/cancel/confirm actions create in-app notifications for candidates and interviewers. Candidates can see their next booking and recent updates in Track Application. No scheduling email delivery is enabled. See [backend scheduling guide](backend/SCHEDULING.md).
