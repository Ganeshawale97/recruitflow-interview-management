# RecruitFlow Platform — Phase 1

New React + TypeScript platform foundation. The legacy HTML prototype is preserved and untouched.

## Requirements
- Node.js 20+
- PostgreSQL 15+ (the UI shell runs without it)

## Frontend
```powershell
cd platform
npm install
npm run dev
```
Open http://localhost:5173.

## Backend API
Open a second terminal:
```powershell
cd platform/backend
npm install
Copy-Item .env.example .env
npm run dev
```
The API listens on http://localhost:4000. Check GET /api/health.

## Database
Create a PostgreSQL database, set DATABASE_URL in platform/backend/.env, then run:
```powershell
psql $env:DATABASE_URL -f schema.sql
```

## Current status
- React/TypeScript app shell and responsive navigation: implemented.
- Initial domain and role model: included in schema.
- API health endpoint: implemented.
- PostgreSQL schema foundation: included.
- Secure login, server-side permissions, candidate workflows and live operations: not yet implemented. Role selector is a UI preview only, not authentication.
