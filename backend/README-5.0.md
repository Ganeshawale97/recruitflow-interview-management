# RecruitFlow 5.0 Backend

## What changed
RecruitFlow now has a shared API foundation:
- PostgreSQL persistence
- JWT authentication
- Protected state endpoints
- Candidate synchronization
- Notification synchronization
- Health monitoring

## Setup
1. Create PostgreSQL database.
2. Run `schema-5.0.sql`.
3. Install dependencies from `package-5.0.json` (or merge them into package.json).
4. Set:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - optional `PORT`
5. Start with `node server-5.0.js`.

## API
- GET `/api/health`
- POST `/api/auth/login`
- GET `/api/state` (JWT required)
- PUT `/api/state` (JWT required)

## Important
The dashboard keeps LocalStorage as a fallback when the API is unavailable. For real deployment, use HTTPS, a managed PostgreSQL database, strong secrets, rate limiting, secure CORS origins, audit logging, backups and proper password reset/session policies.
