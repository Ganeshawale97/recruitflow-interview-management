# RecruitFlow Phase 2 — Multi-organisation foundation

## What this phase adds
- organizations: tenant/workspace records with status and branding fields.
- organization_roles: organisation-scoped roles and JSON permissions.
- organization_memberships: users belonging to organisations.
- platform_owners: separate platform-owner identity, not grantable by an organisation.
- recruitment_events.organization_id: every existing and future event belongs to one organisation.
- Existing events and event-team assignments are migrated into a safe Legacy Workspace; existing Super Admin users are retained as platform owners.

## Apply the migration to an existing local database
1. Back up the database first.
2. Pull this branch.
3. From platform/backend, run:

```powershell
psql -U postgres -d recruitflow -v ON_ERROR_STOP=1 -f migrations/002_multitenancy_foundation.sql
```

Use the correct PostgreSQL username/database for your local setup. Do not share your database password or .env.

## Important scope
This is Phase 2.0, the database foundation only. It does not yet expose public organisation signup, tenant-aware API authorization, branded registration pages, custom panel/domain management, or organisation role administration. Those are subsequent phases. Do not onboard external organisations until tenant scoping is implemented and tested across every API route.

## Isolation design
Organisation membership determines which workspaces a user can enter. Events are owned by one organisation. Event-specific team membership and event-level panel/candidate records remain scoped through their event. The next phase must enforce organisation membership on every authenticated event route and resolve public registration by event slug without exposing other tenant data.
