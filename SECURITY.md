# Security Policy

## Implementation Stage (February 2026)

Current architecture includes:

- Authentication and protected dashboard routes
- AI chat + tool execution
- Message persistence
- Memory extraction pipeline
- Memory decay, archival, and cleanup workers (cron)

This means security must now cover both **interactive app traffic** and **background memory lifecycle jobs**.

## Quick Reference

| Aspect | Implementation |
|--------|----------------|
| **Authentication** | better-auth 1.4.18 with bcrypt password hashing |
| **Session Duration** | 7 days with 24-hour refresh |
| **Rate Limiting** | 10 requests/minute per IP (database-backed) |
| **Memory Background Jobs** | Convex cron: extraction (2m), decay (1h), archival (daily), cleanup (weekly) |
| **Security Posture** | Production-capable core controls with known hardening gaps |

## Security-Critical Surfaces

- **Auth & sessions**: `src/convex/auth.ts`, `src/convex/auth.config.ts`, `src/lib/auth/server.ts`
- **Route/API protection**: `src/proxy.ts`, `src/app/api/chat/route.ts`
- **Config/secrets validation**: `src/lib/env.ts`
- **Headers/CSP**: `next.config.ts`
- **Memory extraction worker**: `src/convex/memoryExtraction.ts`
- **Memory decay worker**: `src/convex/memoryDecay.ts`
- **Memory archival/cleanup worker**: `src/convex/memoryArchival.ts`
- **Schedulers**: `src/convex/crons.ts`

## Production Checklist

### ✅ Implemented

- [x] Password hashing and session management
- [x] CSRF protection enabled
- [x] Route protection for dashboard areas
- [x] Rate limiting configured
- [x] Security headers and CSP configured
- [x] Environment variable validation on startup
- [x] Cookie hardening (`httpOnly`, `secure` in prod, `sameSite=lax`)
- [x] Memory lifecycle controls (decay + archival + cleanup jobs)

### ⚠️ Required Before Production

- [ ] Enable and enforce email verification
- [ ] Add authentication/authorization checks to `src/app/actions/suggestions.ts`
- [ ] Configure and test production-only HTTPS/canonical URLs
- [ ] Define and document memory data retention + deletion policy per tenant
- [ ] Add PII redaction/minimization rules for extracted memory content
- [ ] Configure security contact and private vulnerability intake channel
- [ ] Rotate production secrets before launch (`BETTER_AUTH_SECRET`, provider keys)

### 🔒 Recommended Enhancements

- [ ] Add account lockout and suspicious login detection
- [ ] Add security event logging and alerting (auth failures, unusual tool patterns)
- [ ] Add approval/guardrails layer for high-risk agent actions
- [ ] Add periodic access review for Convex deployment/admin accounts

## Threat Coverage Snapshot

| Threat | Status | Current Mitigation |
|--------|--------|--------------------|
| **CSRF** | ✅ Protected | better-auth protections + same-site cookies |
| **XSS** | ✅ Mostly protected | CSP + httpOnly cookies |
| **Brute force** | ⚠️ Partial | Rate limiting only, no lockout policy yet |
| **Session hijacking** | ✅ Protected | Secure cookies + HTTPS in production |
| **Prompt/data injection into memory** | ⚠️ Partial | Validation + extraction constraints; stronger guardrails pending |
| **Over-retention of stale memory** | ✅ Improving | Decay scores + archival + purge/cleanup jobs |

## Memory Lifecycle Security Notes

Because memory is persisted and transformed asynchronously:

- Treat extracted memory as potentially sensitive business data
- Avoid storing unnecessary personal identifiers in memory content
- Apply retention boundaries (decay thresholds + purge windows)
- Track correction/update lineage to reduce stale or conflicting facts
- Ensure background workers cannot bypass tenant isolation assumptions

## Security Headers

Configured in `next.config.ts`:

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 1; mode=block`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Content-Security-Policy: ...`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`

## Environment & Secret Requirements

Required minimum:

```bash
BETTER_AUTH_SECRET=...                # minimum 32 chars
BETTER_AUTH_URL=https://yourdomain.com
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_DEPLOYMENT=<deployment-name>
```

At least one AI provider key must be configured, and keys used by background workers (`OPENROUTER_API_KEY` and/or `OPENAI_API_KEY`) must be present in the deployment environment.

## Incident Response

If a security incident is suspected:

1. Rotate authentication and AI provider secrets immediately
2. Invalidate active sessions where appropriate
3. Temporarily disable high-risk background jobs if data integrity is uncertain
4. Inspect memory/event logs and affected tenant scope
5. Patch and redeploy with validated remediation
6. Notify affected stakeholders as required by policy/regulation

## Vulnerability Reporting

- Do not open public issues for security vulnerabilities
- Report through a private contact channel (to be configured)
- Include impact, reproduction steps, and affected environment details
- Target initial acknowledgement within 48 hours

## Operational Security Cadence

### Weekly
- Review failed logins and rate-limit patterns
- Review background worker failures and retries

### Monthly
- Run dependency audit and patch critical CVEs
- Review memory retention and purge behavior
- Validate CSP and auth configuration drift

### Quarterly
- Perform focused app + memory pipeline security review
- Rotate selected secrets and verify runbooks
- Reassess compliance obligations (GDPR/CCPA/etc.)

---

**Last Updated**: 2026-02-23
