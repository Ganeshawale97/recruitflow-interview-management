# RecruitFlow Platform — Phase 1.3

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
