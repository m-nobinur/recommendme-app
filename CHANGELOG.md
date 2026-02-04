# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.0] - 2026-02-04

### Added

#### AI Architecture Refactoring
- Centralized AI configuration system with Zod validation
- Environment variable mapping for flexible AI configuration
- Multi-provider AI system with 5 providers (Gateway, Gemini, OpenAI, OpenRouter, Groq)
- Model tier abstraction (smartest/smart/regular) for cost-performance tradeoffs
- AI services layer with monitoring, retry logic, and structured outputs
- Request ID generation for distributed tracing
- Comprehensive monitoring and metrics collection
- Rate limiting utilities for API quota management
- Suggestion generation service with structured output validation
- System and suggestion prompt management with version control
- `.env.ai.example` with comprehensive AI configuration documentation

#### CI/CD Pipeline
- GitHub Actions CI workflow for automated testing and validation
- Automated linting, type checking, and formatting validation
- Build verification for Next.js application
- Security audit integration
- Fast feedback loop (< 5 minutes typical)
- Vercel handles automatic deployments on push to main

#### Code Quality & Developer Experience
- Husky 9.1.7 for Git hooks automation
- Pre-commit hook: Type checking + Biome checks
- Commit message validation (Conventional Commits)
- Pre-push hook: Full validation before remote push
- `validate` script for quick validation

### Changed

#### API & Backend
- Refactored chat API route to use centralized AI configuration
- Improved error handling with structured error objects and request tracking
- Added configurable timeouts with abort signals
- Enhanced authentication flow with proper error responses
- Environment-aware debug logging (disabled in production)

#### Services & Actions
- Migrated suggestions action from direct Gemini calls to service layer
- Simplified suggestion generation (45 lines → 35 lines)
- Added automatic retry logic for transient failures
- Improved token usage tracking and performance metrics

#### UI & Components
- Integrated centralized model store for provider/tier selection
- Cleaned up verbose optimization comments across components
- Simplified ChatContainer, ChatInput, MessageBubble, and TypingIndicator
- Streamlined dashboard components and layouts
- Updated auth layouts and pages for better code clarity

### Removed

- Unused font packages (@fontsource/geist-sans, @fontsource/geist-mono)
- Redundant code comments and documentation
- Unnecessary optimization markers

### Fixed

- Production logging verbosity in Convex auth triggers
- Type safety improvements across AI services
- Error handling edge cases in chat API

### Security

- Request timeout implementation preventing hung connections
- Feature flags for controlled rollout of sensitive features
- Environment-based configuration reduces hardcoded secrets
- Improved error messages without exposing internal details

## [2.0.0] - 2026-02-03

### Added

#### CRM Features
- Natural language chat interface for CRM operations
- Lead management with status tracking (new, contacted, qualified, unqualified, customer)
- Appointment scheduling system with lead linkage
- Invoice generation with line items and due dates
- Real-time data synchronization across all clients
- Chat history persistence with tool call tracking
- Multi-tenant organization support with data isolation

#### AI Integration
- Multi-provider AI support with 5 providers:
  - Vercel AI Gateway (default)
  - Google Gemini (Flash and Pro models)
  - OpenAI (GPT-4o, GPT-4o Mini, o3-mini)
  - OpenRouter (100+ models)
  - Groq (ultra-fast inference with LPU)
- Provider/model selection with persistence
- Streaming responses for real-time interaction
- Tool calling for CRM operations (6 tools)
- Multi-step reasoning (up to 5 steps)

#### Authentication & Security
- Better Auth authentication with email/password
- Secure session management (7-day sessions, 24-hour refresh)
- Rate limiting (10 requests/minute per IP)
- CSRF protection enabled
- Comprehensive security headers (CSP, X-Frame-Options, HSTS)
- Environment variable validation with Zod
- Route protection middleware
- Cookie security (httpOnly, secure in prod, sameSite=lax)

#### UI/UX
- Dark mode by default with amber/orange theme
- Responsive chat interface with markdown support
- Typing indicators for AI responses
- Loading skeletons for better UX
- Error boundaries for graceful error handling
- Dashboard layout with sidebar navigation
- Settings page for AI provider configuration

### Technical

#### Framework & Core
- Next.js 16.1.6 with App Router
- React 19.0.0 with React Server Components
- TypeScript 5.7.0 with strict mode
- Turbopack for fast development builds

#### Backend & Database
- Convex 1.31.7 for real-time backend
- Better Auth 1.4.18 with Convex integration
- Multi-tenant database schema
- Transactional data operations

#### AI & ML
- Vercel AI SDK 6.0.68 with streaming support
- Multiple AI provider SDKs:
  - `@ai-sdk/google` 3.0.20
  - `@ai-sdk/openai` 3.0.25
  - `@ai-sdk/groq` 3.0.21
  - `@openrouter/ai-sdk-provider` 2.1.1

#### Styling & UI
- Tailwind CSS 4.0.0 with PostCSS
- Geist font family (Sans + Mono)
- Lucide React icons 0.563.0
- Custom UI component library

#### State Management & Utils
- Zustand 5.0.11 for client state
- Zod 4.0.1 for schema validation
- React Markdown 10.1.0 for message rendering
- clsx + tailwind-merge for className utilities

#### Development Tools
- Biome 2.3.13 (linter + formatter, replaces ESLint/Prettier)
- Concurrently 9.2.1 for running dev servers
- npm-run-all2 8.0.4 for script orchestration

### Security

- Rate limiting configured (10 req/min per IP, database-backed)
- CSRF protection enabled by default
- XSS protection via httpOnly cookies
- Content Security Policy (CSP) implemented
- Strict-Transport-Security (HSTS) enabled in production
- Environment variable validation
- Secure session management with automatic refresh
- Origin validation for cross-origin requests
- IP tracking for security audits

### Changed

- Migrated from ESLint/Prettier to Biome for unified tooling
- Updated to latest React 19 patterns
- Improved development workflow with concurrent dev servers
- Enhanced security headers configuration

### Fixed

- Session persistence across page reloads
- Type safety improvements across codebase
- Environment variable validation edge cases

## [1.0.0] - Initial Release

Initial prototype with basic functionality.

---

## Release Notes

### Upgrading to 2.0.0

This is a major version with breaking changes:

1. **Node.js Requirement**: Node.js 20.9.0+ required
2. **Bun Preferred**: Project now enforces Bun as package manager
3. **Biome Migration**: Replace ESLint/Prettier configs with Biome
4. **Environment Variables**: New required variables (see `.env.example`)

### What's Next?

Planned features for future releases:

- Email verification for authentication
- Two-factor authentication (2FA)
- Advanced reporting and analytics
- Email integration for automated follow-ups
- Calendar integrations (Google Calendar, Outlook)
- Mobile app (React Native)
- Webhook support for external integrations
- Advanced search with filters
- Export functionality (CSV, PDF)
- Team collaboration features

---

**For detailed security information, see [SECURITY.md](SECURITY.md)**  
**For code style guidelines, see [AGENTS.md](AGENTS.md)**
