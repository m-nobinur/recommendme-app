# RecommendMe AI

An AI-powered assistant with a natural language interface for lead management, appointments, and invoicing. Built with Next.js 16, React 19, Convex, and the Vercel AI SDK.

## Features

- **Natural Language Interface**: Chat with your CRM using everyday language
- **Lead Management**: Add, update, search, and track leads through conversation
- **Appointment Scheduling**: Book and manage appointments seamlessly
- **Invoice Generation**: Create and send invoices via chat commands
- **Multi-Provider AI**: Choose from 5 AI providers (Gateway, Gemini, OpenAI, OpenRouter, Groq)
- **Real-time Database**: Powered by Convex for instant data sync
- **Modern Auth**: Secure authentication with better-auth
- **Dark Mode UI**: Beautiful amber/orange themed dark interface

## Tech Stack

- **Framework**: [Next.js 16.1.6](https://nextjs.org/) with App Router
- **UI Library**: [React 19.0.0](https://react.dev/)
- **Database**: [Convex 1.31.7](https://convex.dev/) (real-time backend)
- **AI**: [Vercel AI SDK 6.0.68](https://sdk.vercel.ai/) with streaming
- **Auth**: [better-auth 1.4.18](https://better-auth.com/)
- **Styling**: [Tailwind CSS 4.0.0](https://tailwindcss.com/)
- **Linter/Formatter**: [Biome 2.3.13](https://biomejs.dev/)
- **Language**: TypeScript 5.7.0
- **Runtime**: Node.js 20.9.0+

## Getting Started

### Prerequisites

- Node.js 20.9.0+ or Bun (recommended)
- A Convex account (free tier available)
- At least one AI provider API key

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-org/recommendme-app.git
   cd recommendme-app
   ```

2. **Install dependencies**

   ```bash
   bun install
   # or npm install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Fill in your environment variables (see [Environment Variables](#environment-variables) below).

4. **Start the development servers**

   ```bash
   bun dev
   # This runs both Next.js and Convex dev servers concurrently
   ```

   On first run, Convex will prompt you to log in and create a project.

5. **Open the app**

   Visit [http://localhost:3000](http://localhost:3000)

## Environment Variables

Create a `.env.local` file with the following variables:

```env
# Convex (required)
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
CONVEX_DEPLOYMENT=your-deployment-name

# Authentication (required)
BETTER_AUTH_SECRET=your-secret-key-at-least-32-characters-long
BETTER_AUTH_URL=http://localhost:3000

# AI Providers (configure at least one)
GOOGLE_GENERATIVE_AI_API_KEY=your-google-ai-api-key    # Gemini (recommended)
OPENAI_API_KEY=sk-your-openai-api-key                  # OpenAI GPT models
OPENROUTER_API_KEY=sk-or-v1-your-openrouter-api-key    # OpenRouter (100+ models)
GROQ_API_KEY=gsk_your-groq-api-key                     # Groq (ultra-fast)
AI_GATEWAY_API_KEY=your-gateway-api-key                # Vercel AI Gateway (optional)

# Application URL (optional)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Getting API Keys

| Provider              | How to Get                                                      |
| --------------------- | --------------------------------------------------------------- |
| **Convex**            | Run `bun dev` and follow prompts on first run                   |
| **better-auth**       | Generate with `openssl rand -base64 32`                         |
| **Google Gemini**     | Get key from [Google AI Studio](https://aistudio.google.com/)   |
| **OpenAI**            | Sign up at [platform.openai.com](https://platform.openai.com/)  |
| **OpenRouter**        | Sign up at [openrouter.ai](https://openrouter.ai/)              |
| **Groq**              | Sign up at [console.groq.com](https://console.groq.com/)        |
| **Vercel AI Gateway** | Configure at [vercel.com](https://vercel.com/) (auto-auth)      |

## Project Structure

```
recommendme-app/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/             # Auth routes (login, register)
│   │   ├── (dashboard)/        # Protected routes (chat, settings)
│   │   ├── api/                # API routes
│   │   │   ├── auth/[...all]/  # better-auth handler
│   │   │   └── chat/           # AI streaming endpoint
│   │   └── actions/            # Server actions
│   ├── components/
│   │   ├── chat/               # Chat UI (MessageBubble, ChatInput, etc.)
│   │   ├── ui/                 # Reusable UI (Button, Form, etc.)
│   │   └── dashboard/          # Dashboard components
│   ├── convex/                 # Convex backend (separate tsconfig)
│   │   ├── schema.ts           # Database schema
│   │   ├── leads.ts            # Lead mutations/queries
│   │   ├── appointments.ts     # Appointment mutations/queries
│   │   ├── invoices.ts         # Invoice mutations/queries
│   │   └── auth.ts             # Better Auth integration
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── providers/      # Multi-provider factory (5 providers)
│   │   │   ├── tools/          # CRM tool definitions
│   │   │   └── prompts/        # System prompts
│   │   ├── auth/               # Auth helpers (client/server)
│   │   └── env.ts              # Environment validation
│   ├── stores/                 # Zustand state management
│   └── proxy.ts                # Route protection middleware
├── public/                     # Static assets
├── biome.json                  # Biome configuration
├── convex.json                 # Convex configuration
├── next.config.ts              # Next.js + security headers
├── package.json
└── tsconfig.json
```

## Development Scripts

| Command              | Description                                      |
| -------------------- | ------------------------------------------------ |
| `bun dev`            | Start both Next.js and Convex dev servers        |
| `bun dev:next`       | Start only Next.js dev server                    |
| `bun dev:convex`     | Start only Convex dev server                     |
| `bun build`          | Build Next.js for production                     |
| `bun build:all`      | Deploy Convex and build Next.js                  |
| `bun start`          | Start production server                          |
| `bun lint`           | Run Biome linter                                 |
| `bun lint:fix`       | Auto-fix lint issues                             |
| `bun format`         | Format code with Biome                           |
| `bun format:check`   | Check code formatting                            |
| `bun typecheck`      | Run TypeScript type checker                      |
| `bun check:all`      | Run typecheck + lint (run before commits)        |
| `bun convex:dev`     | Start Convex dev server (alternative)            |
| `bun convex:deploy`  | Deploy Convex to production                      |
| `bun convex:logs`    | View Convex logs                                 |
| `bun convex:dashboard` | Open Convex dashboard                          |

## AI Chat Commands

The AI assistant understands natural language. Here are some example commands:

### Lead Management

- "Add a new lead: John Smith, john@example.com, interested in premium plan"
- "Show me all leads from this week"
- "Update the lead John Smith - mark as qualified"
- "Search for leads in the technology industry"

### Appointments

- "Schedule a meeting with John Smith for tomorrow at 2pm"
- "What's on my calendar for next week?"
- "Reschedule the meeting with Acme Corp to Friday"
- "Cancel the appointment with John"

### Invoices

- "Create an invoice for Acme Corp: Website redesign $5000"
- "Show me unpaid invoices"
- "Mark invoice #1234 as paid"

## Deployment

### Deploy to Vercel

1. **Push your code to GitHub**

   ```bash
   git push origin main
   ```

2. **Import project in Vercel**
   - Visit [vercel.com](https://vercel.com/)
   - Import your GitHub repository
   - Configure environment variables (see [Environment Variables](#environment-variables))

3. **Deploy Convex first**

   ```bash
   bun convex:deploy
   ```

   Copy the production Convex URL to your Vercel environment variables.

4. **Deploy to Vercel**
   - Click "Deploy" in Vercel dashboard
   - Vercel will build and deploy automatically

### Production Checklist

- [ ] Set all environment variables in Vercel
- [ ] Deploy Convex with `bun convex:deploy`
- [ ] Update `NEXT_PUBLIC_CONVEX_URL` with production URL
- [ ] Set `BETTER_AUTH_URL` to your production domain
- [ ] Enable email verification (see SECURITY.md)
- [ ] Configure CORS for production domain
- [ ] Review security headers in `next.config.ts`

## Code Quality

This project uses [Biome](https://biomejs.dev/) for linting and formatting:

- **Linting**: `bun lint` (fix with `bun lint:fix`)
- **Formatting**: `bun format` (check with `bun format:check`)
- **Type checking**: `bun typecheck`
- **Full check**: `bun check:all` (run before commits)

See [AGENTS.md](AGENTS.md) for code style guidelines.

## Security

See [SECURITY.md](SECURITY.md) for security policy and best practices.

## License

Copyright (c) 2026 RecommendMe Team. All rights reserved. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Vercel](https://vercel.com/) for Next.js and AI SDK
- [Convex](https://convex.dev/) for the real-time backend
- [better-auth](https://better-auth.com/) for authentication
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Biome](https://biomejs.dev/) for linting and formatting
