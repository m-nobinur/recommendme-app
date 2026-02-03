# Security Policy

## Quick Reference

| Aspect | Implementation |
|--------|----------------|
| **Authentication** | better-auth 1.4.18 with bcrypt password hashing |
| **Session Duration** | 7 days with 24-hour refresh |
| **Rate Limiting** | 10 requests/minute per IP (database-backed) |
| **Security Score** | 7/10 (production-ready with caveats) |

## Implementation Overview

Key security files and their purposes:

- **Authentication**: [`src/convex/auth.ts`](src/convex/auth.ts) - Better Auth configuration
- **Auth Config**: [`src/convex/auth.config.ts`](src/convex/auth.config.ts) - JWT validation
- **API Protection**: [`src/app/api/chat/route.ts`](src/app/api/chat/route.ts) - Auth checks
- **Route Protection**: [`src/proxy.ts`](src/proxy.ts) - Middleware for protected routes
- **Session Management**: [`src/lib/auth/server.ts`](src/lib/auth/server.ts) - Server-side auth helpers
- **Environment Validation**: [`src/lib/env.ts`](src/lib/env.ts) - Secrets validation
- **Security Headers**: [`next.config.ts`](next.config.ts) - CSP and security headers

## Production Checklist

### ✅ Already Implemented

- [x] Secure password hashing (bcrypt)
- [x] Password requirements (8-128 characters)
- [x] Session management (7-day sessions, 24-hour refresh)
- [x] CSRF protection enabled
- [x] Rate limiting (10 req/min per IP)
- [x] Origin validation
- [x] XSS protection (httpOnly cookies)
- [x] Security headers configured (CSP, X-Frame-Options, HSTS, etc.)
- [x] Environment variable validation
- [x] Cookie security (httpOnly, secure in prod, sameSite=lax)
- [x] Session invalidation on logout

### ⚠️ Required Before Production

- [ ] **Enable email verification** (currently disabled for dev)
- [ ] **Configure production URLs** (HTTPS required)
- [ ] **Set up email service** (password reset, verification)
- [ ] **Review CORS settings** (whitelist production domains)
- [ ] **Add authentication to server actions** ([`src/app/actions/suggestions.ts`](src/app/actions/suggestions.ts))
- [ ] **Rotate secrets** (generate new `BETTER_AUTH_SECRET`)

### 🔒 Recommended Enhancements

- [ ] Two-factor authentication (2FA)
- [ ] Account lockout after failed attempts
- [ ] Security event logging
- [ ] Session management UI (view/revoke sessions)
- [ ] Security monitoring/alerting

## Attack Prevention

| Threat | Status | Implementation |
|--------|--------|----------------|
| **CSRF** | ✅ Protected | Enabled by default in better-auth |
| **XSS** | ✅ Protected | httpOnly cookies, CSP headers |
| **Rate Limiting** | ✅ Protected | 10 req/min per IP (database-backed) |
| **SQL Injection** | ✅ N/A | Using Convex (not SQL) |
| **Session Hijacking** | ✅ Protected | Secure cookies, HTTPS in prod |
| **Brute Force** | ⚠️ Partial | Rate limiting only, no account lockout |
| **Man-in-the-Middle** | ✅ Protected | HSTS, HTTPS enforced in production |

## Security Headers

Configured in [`next.config.ts`](next.config.ts):

```typescript
X-Frame-Options: DENY                    // Prevent clickjacking
X-Content-Type-Options: nosniff          // Prevent MIME sniffing
Referrer-Policy: strict-origin-when-cross-origin
X-XSS-Protection: 1; mode=block
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: [comprehensive policy]
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### Content Security Policy (CSP)

Development:
- Allows `unsafe-eval` for hot reloading
- Allows `unsafe-inline` for styled-jsx

Production:
- Restricts script sources to `self` + `unsafe-inline` (Next.js requirement)
- Connects to Convex, OpenAI, Google AI
- Upgrades insecure requests

## Environment Variables

### Required Secrets

```bash
# Authentication (minimum 32 characters)
BETTER_AUTH_SECRET=your-secret-key-at-least-32-characters-long
BETTER_AUTH_URL=https://yourdomain.com  # HTTPS in production

# Convex (from deployment)
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
CONVEX_DEPLOYMENT=your-deployment-name

# AI Providers (at least one)
GOOGLE_GENERATIVE_AI_API_KEY=...
OPENAI_API_KEY=...
OPENROUTER_API_KEY=...
GROQ_API_KEY=...
```

### Validation

All environment variables are validated on startup via [`src/lib/env.ts`](src/lib/env.ts):

- `BETTER_AUTH_SECRET` must be ≥32 characters
- `NEXT_PUBLIC_CONVEX_URL` must be valid URL
- API keys validated for presence and format

### Storage

- **Development**: Use `.env.local` (never commit to git)
- **Production**: Set in Vercel environment variables
- **Convex Secrets**: Set with `npx convex env set SECRET_NAME value`

## Authentication Configuration

### Password Requirements

```typescript
// In src/convex/auth.ts
emailAndPassword: {
  minPasswordLength: 8,
  maxPasswordLength: 128,  // Prevents DoS attacks
  requireEmailVerification: false,  // ⚠️ Enable in production
  autoSignIn: true,  // Auto sign-in after registration
}
```

### Session Configuration

```typescript
session: {
  expiresIn: 60 * 60 * 24 * 7,     // 7 days
  updateAge: 60 * 60 * 24,         // Refresh every 24 hours
  cookieCache: { enabled: true, maxAge: 60 * 5 }  // 5-minute cache
}
```

### Rate Limiting

```typescript
rateLimit: {
  window: 60,        // 1 minute window
  max: 10,           // Max 10 requests
  storage: "database" // Persistent storage
}
```

## Development vs Production

| Setting | Development | Production |
|---------|-------------|------------|
| **Protocol** | HTTP allowed | HTTPS required |
| **Secure Cookies** | `false` | `true` |
| **Email Verification** | Disabled | Must enable |
| **CSP** | Allows `unsafe-eval` | Strict policy |
| **Auth Bypass** | Optional (`DISABLE_AUTH_IN_DEV`) | Never allowed |

## Incident Response

If a security breach is detected:

1. **Immediately rotate** `BETTER_AUTH_SECRET` in production
2. **Invalidate all sessions** by changing the secret
3. **Force password reset** for affected users
4. **Review logs** to identify attack vector
5. **Patch vulnerabilities** and deploy fix
6. **Notify affected users** (if applicable)
7. **Document incident** for future reference

## Reporting Vulnerabilities

To report security vulnerabilities:

1. **Do not** open public GitHub issues
2. Email: [Add your security contact email]
3. Include: Description, steps to reproduce, impact assessment
4. Allow 48 hours for initial response

## Regular Security Tasks

### Daily
- Monitor error logs for unusual patterns
- Check failed login attempts

### Weekly
- Review rate limit violations
- Check for dependency updates with known vulnerabilities

### Monthly
- Run `bun audit` and update dependencies
- Review security configurations
- Test authentication flows

### Quarterly
- Full security audit
- Update security documentation
- Review and rotate secrets (if needed)

## Compliance Considerations

Depending on your use case, consider:

- **GDPR**: If serving EU users (data privacy, right to deletion)
- **CCPA**: If serving California residents
- **HIPAA**: If handling health data
- **SOC 2**: For enterprise customers

## Resources

- [Better Auth Security](https://www.better-auth.com/docs/security)
- [Convex Security](https://docs.convex.dev/security)
- [Next.js Security](https://nextjs.org/docs/app/building-your-application/configuring/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

---

**Last Updated**: 2026-02-03  
**Security Contact**: [To be configured]

## Strengths

- ✅ Solid foundation with better-auth
- ✅ Comprehensive security headers
- ✅ Rate limiting implemented
- ✅ Secure session management
- ✅ Environment validation
- ✅ Cookie security configured

## Areas for Improvement

- ⚠️ Email verification disabled (for production)
- ⚠️ Missing 2FA support
- ⚠️ No account lockout mechanism
- ⚠️ Server actions lack auth checks
- ⚠️ Missing security monitoring
