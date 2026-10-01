# RecruitFlow Backend

RecruitFlow 4.5 introduces the backend architecture.

## Stack
- Node.js + Express API
- PostgreSQL database
- CORS + JSON API
- Frontend remains compatible with the existing LocalStorage prototype

## Run locally

1. Install Node.js and PostgreSQL.
2. Create a PostgreSQL database.
3. Run `schema.sql` against that database.
4. Install dependencies:

```bash
npm install
```

5. Set the database connection:

Windows PowerShell:
```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/recruitflow"
```

6. Start:

```npm start
```

The health endpoint is:
`GET /api/health`

The Organizer Dashboard 4.5 Backend & Database page can test the endpoint.

## Important
This is the first backend foundation, not the final production security layer. Authentication should use password hashing, secure sessions/JWT, role middleware, validation, rate limiting and HTTPS before deployment.
