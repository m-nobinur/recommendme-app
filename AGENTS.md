# AGENTS.md - AI Agent Guidelines for recommendme-app

## Project Overview
AI-powered assistant with Next.js 16.1.6, React 19.0.0, Convex 1.31.7 backend, and Vercel AI SDK 6.0.68.

## Build, Lint, and Test Commands

### Package Manager
Use **bun** (preferred) or npm. Node.js 20.9.0+ required.

### Commands
```bash
bun dev                  # Start both Next.js and Convex (concurrently)
bun dev:next             # Start only Next.js dev server
bun dev:convex           # Start only Convex dev server
bun build                # Production build (Next.js only)
bun build:all            # Deploy Convex + build Next.js
bun start                # Start production server
bun lint                 # Run Biome linter
bun lint:fix             # Auto-fix lint issues
bun format               # Format code with Biome
bun format:check         # Check code formatting
bun typecheck            # TypeScript type checker
bun validate             # Run typecheck + lint (quick validation)
bun check:all            # Full validation (typecheck + lint) - run before commits
bun convex:dev           # Start Convex dev server
bun convex:deploy        # Deploy Convex to production
bun convex:logs          # View Convex logs
bun convex:dashboard     # Open Convex dashboard
```

### Git Hooks (Husky 9.1.7)

Automated quality gates enforce code standards:

- **pre-commit**: Runs `typecheck` + `check:ci` before each commit
- **commit-msg**: Validates Conventional Commits format
- **pre-push**: Full validation before pushing to remote

**Commit Message Format** (enforced):
```
<type>(<scope>): <subject>

Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
```

### Testing
Unit tests use Node's built-in test runner (`node:test`) — no external framework required.

```bash
bun test                         # Run all unit tests
bun test ./src/lib/ai/memory/    # Run memory-layer unit tests (8 tests)
bun run test:memory:smoke        # End-to-end memory pipeline smoke test
bun run test:memory:all          # Full memory test suite (smoke + validate + tools)
```

Test files live alongside source files (`*.test.ts`). Validation also relies on `bun run check:all`.

## Code Style Guidelines

### Formatting (Biome)
- **Indentation**: 2 spaces
- **Line width**: 100 characters
- **Quotes**: Single quotes
- **Trailing commas**: ES5 style
- **Line endings**: LF

### Import Organization
```typescript
'use client';                                    // 1. Directives
import { Icon } from 'lucide-react';             // 2. External packages
import type { SomeType } from 'some-package';    // 3. Type imports (use 'import type')
import { useCallback, useState } from 'react';   // 4. React imports
import { Button } from '@/components/ui/Button'; // 5. Internal imports (@/)
```

### TypeScript Patterns
**Use `interface` for object shapes and props:**
```typescript
interface Props {
  onSend: (message: string) => void;
  isLoading?: boolean;
}
```

**Use `type` for unions and aliases:**
```typescript
export type AIProvider = 'openrouter' | 'gemini-direct';
export type ServerEnv = z.infer<typeof serverEnvSchema>;
```

### Naming Conventions
| Element | Convention | Example |
|---------|------------|---------|
| Components | PascalCase | `ChatInput.tsx` |
| Utilities/Hooks | camelCase | `cn.ts`, `model.store.ts` |
| Functions | camelCase | `handleSubmit` |
| Constants | SCREAMING_SNAKE_CASE | `SUGGESTIONS` |
| Interfaces/Types | PascalCase | `ButtonProps`, `AIProvider` |

### Component Patterns
```typescript
const ChatInput: React.FC<Props> = ({ onSend, isLoading }) => {
  const [text, setText] = useState('');           // 1. Hooks
  const handleSubmit = useCallback(() => {}, []); // 2. Callbacks
  useEffect(() => {}, []);                        // 3. Effects
  return (/* JSX */);                             // 4. Render
};
export default memo(ChatInput);
```

**forwardRef for UI primitives:**
```typescript
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', ...props }, ref) => (
    <button ref={ref} className={cn(baseStyles, className)} {...props} />
  )
);
Button.displayName = 'Button';
```

### Error Handling
```typescript
catch (error) {
  console.error('API error:', error);
  return { error: error instanceof Error ? error.message : 'Unknown error' };
}
```

## Project Architecture

### Directory Structure
```
src/
├── app/                # Next.js App Router
│   ├── (auth)/        # Auth routes (login, register)
│   ├── (dashboard)/   # Protected routes
│   │   └── chat/components/  # Page-specific components
│   ├── api/           # API routes
│   └── actions/       # Server actions
├── components/        # Shared components (ui/, chat/, layout/)
├── contexts/          # React contexts
├── convex/            # Convex backend (separate tsconfig)
├── lib/               # Utilities (ai/, auth/, utils/)
└── stores/            # Zustand stores
```

### Path Aliases
- `@/*` → `./src/*`
- `@convex/*` → `./src/convex/*`

### Tech Stack
Next.js 16.1.6 | React 19.0.0 | Convex 1.31.7 | better-auth 1.4.18 | Vercel AI SDK 6.0.68 | Tailwind v4.0.0 | Biome 2.3.13 | Husky 9.1.7 | Zustand 5.0.11 | Zod 4.0.1 | TypeScript 5.7.0

## Convex Backend

Functions in `src/convex/` with separate `tsconfig.json`. Relaxed lint rules apply (noExplicitAny allowed).

```typescript
// Mutation
export const create = mutation({
  args: { name: v.string(), organizationId: v.id('organizations') },
  handler: async (ctx, args) => ctx.db.insert('leads', { ...args, createdAt: Date.now() }),
});

// Query
export const list = query({
  args: { organizationId: v.id('organizations') },
  handler: async (ctx, args) =>
    ctx.db.query('leads').withIndex('by_org', (q) => q.eq('organizationId', args.organizationId)).collect(),
});
```

## Styling

**Use `cn()` utility for conditional classes:**
```typescript
import { cn } from '@/lib/utils/cn';
<button className={cn('px-4 py-2', isActive && 'bg-amber-500', className)} />
```

**Semantic tokens:** `bg-surface-muted`, `border-border`, `text-gray-400`, `text-amber-500`

## Notes
- Dark mode by default
- Generated `_generated/` directories are not linted
- No Cursor/Copilot rules configured
