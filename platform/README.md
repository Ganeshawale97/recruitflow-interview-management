# RecruitFlow Platform — Phase 1.1

The new React + TypeScript platform is separate from the preserved legacy HTML prototypes.

## Requirements
- Node.js 20+
- PostgreSQL 15+ (PostgreSQL 18 is supported)

## 1. Frontend
```powershell
cd platform
npm install
npm run dev
```
Open http://localhost:5173.

## 2. Backend and authentication
In a second terminal:
```powershell
cd platform/backend
npm install
Copy-Item .env.example .env
```
Edit `.env`: set your PostgreSQL password in DATABASE_URL, replace JWT_SECRET with a random secret of 32+ characters, and set a unique BOOTSTRAP_ADMIN_PASSWORD of at least 12 characters.

Create the first administrator once:
```powershell
npm run create-admin
```
Then start the API:
```powershell
npm run dev
```
Check http://localhost:4000/api/health.

## 3. Database schema
If not already applied:
```powershell
psql -U postgres -d recruitflow -f schema.sql
```

## 4. Sign in
Open http://localhost:5173 and sign in with the bootstrap admin username/email and password from your local `.env`.

## Security notes
- Passwords are hashed with bcryptjs (12 rounds).
- Login uses a short-lived 8-hour JWT and is rate-limited.
- API routes enforce role permissions on the server.
- The browser keeps the session token in sessionStorage and clears it on logout.
- The bootstrap script refuses to overwrite an existing admin account.
- Never commit your real `.env` file or share credentials.
- This is the initial authentication foundation. Password reset, MFA, refresh-token rotation, account suspension UI and audit logging for every admin action remain future hardening tasks.
