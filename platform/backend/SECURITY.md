# RecruitFlow backend security notes

This document records the security controls currently implemented by the API and the deployment checks operators must complete.

## Authentication and sessions

- API access tokens are signed with `JWT_SECRET`, with the `recruitflow-api` issuer and `recruitflow-platform` audience.
- The API rejects authentication when `JWT_SECRET` is missing or shorter than 32 characters.
- Authenticated requests must reference an active, unexpired, non-revoked database session.
- Users can inspect active sessions and revoke sessions belonging to their own account.
- Password changes and multi-factor authentication are handled by authenticated endpoints. MFA secrets are encrypted at rest using AES-256-GCM; backup codes are stored as bcrypt hashes.

## Authorization and tenant boundaries

- Event routes apply server-side role checks; hiding a frontend control is not treated as authorization.
- Organization workspace routes verify active organization membership and event ownership.
- Interviewer candidate data and resume access are scoped to candidates with a domain represented by one of the interviewer's active panel assignments.
- Database queries use parameterized values for user-supplied data.
- Candidate CSV exports quote cell values and neutralize spreadsheet formula prefixes to reduce formula-injection risk.
- MFA backup-code consumption uses a conditional database update so one backup code cannot be redeemed successfully by concurrent requests.

## Public endpoint abuse controls

- Login and MFA verification have separate request limits.
- Candidate registration is limited to 20 requests per IP per hour.
- Candidate registration validates email and phone formats, HTTPS profile links, domain preference count and identifiers, and custom registration field types before database writes.
- Resume uploads are limited to 5 requests per IP per hour.
- Candidate application tracking uses a 20-request per IP / 15-minute limiter.
- These limits use the process-local default store. Multi-instance deployments should configure a shared rate-limit store and trusted proxy settings before exposing the API publicly.

## Resume handling

- Only PDF and DOCX uploads are accepted.
- MIME type, extension, base64 encoding, file size and file signature are validated server-side.
- The maximum accepted resume size is 5 MiB.
- Uploaded files are stored outside the public static upload directory with restrictive file permissions.
- Resume download requires an authenticated organizer or an interviewer with an active assignment relevant to the candidate.
- Replacing a resume removes the previous stored file after the new database record is committed. Failed database writes remove the newly written file.

## Health checks

- `GET /api/health` is a liveness/status endpoint and reports whether PostgreSQL is configured and reachable.
- `GET /api/health/ready` is a readiness endpoint. It returns HTTP 503 until PostgreSQL is reachable and authentication is configured.

## Deployment checklist

1. Set a unique random `JWT_SECRET` of at least 32 characters.
2. Set `DATABASE_URL` and verify the database user has only the permissions required by the application.
3. Set `CORS_ORIGIN` to the exact production frontend origins; do not use a wildcard for an authenticated deployment.
4. Terminate TLS at a trusted reverse proxy and configure Express trusted-proxy behavior only for known proxy hops.
5. Configure a shared rate-limit store when running more than one API instance.
6. Keep `private-resumes/`, `.env`, database backups and runtime logs out of public static hosting and source control.
7. Verify database migrations, backups, restore procedures, access logs and alerting before launch.
8. Run `npm run check` and `npm test` in `platform/backend`, plus the frontend production build, before deployment.

## Scope and limitations

The controls above are application-level safeguards, not a substitute for a deployment security review. Production readiness still requires infrastructure review, dependency scanning, database migration verification, end-to-end authorization tests and a tested backup/restore process.
