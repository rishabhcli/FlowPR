---
description: FlowPR agent and InsForge integration instructions
globs: *
alwaysApply: true
---

# FlowPR Repository Guidance

FlowPR is an autonomous frontend QA engineer. It opens a live app, tests an important user flow, captures evidence, diagnoses failures, prepares a focused patch, verifies the fix, and opens a GitHub PR with proof.

## Repo Shape

- Use `pnpm` with the checked-in workspace layout; do not introduce npm/yarn lockfiles.
- Root package: orchestration scripts and shared dev dependencies.
- `apps/dashboard`: Next.js 15 + React 19 dashboard and API routes on port 3000.
- `apps/demo-target`: seeded Next.js demo app on port 3100 with the mobile checkout Playwright test.
- `packages/agent`: Redis worker and autonomous run state machine.
- `packages/tools`: provider/runtime integrations for InsForge, TinyFish, Redis, GitHub, Senso, WunderGraph, Guild.ai, and readiness checks.
- `packages/schemas`: shared run, provider artifact, and label types. Update this package first when changing cross-package contracts.
- `skills/flowpr-autonomous-frontend-qa`: Shipables skill package, runbook, references, and skill scripts.

## Local Commands

- Install: `pnpm install`
- Dashboard: `pnpm dev:dashboard`
- Worker: `pnpm worker:dev`
- Demo target: `pnpm dev:demo`
- Typecheck all packages: `pnpm typecheck`
- Lint alias: `pnpm lint`
- Build all packages: `pnpm build`
- Redis smoke test: `pnpm redis:smoke`
- Guild evaluation: `pnpm guild:evaluate`
- Demo checkout test: `pnpm phase4:checkout-test`
- Skill dry run: `pnpm skill:dry-run`

Run the smallest relevant verification for the change. For shared schema/tooling changes, prefer `pnpm typecheck`; for dashboard UI/API changes, use the dashboard build or typecheck; for demo checkout behavior, use `pnpm phase4:checkout-test`.

## Environment

- Copy `.env.example` to `.env` for local work.
- Required for the full loop: `TINYFISH_API_KEY`, `REDIS_URL`, `INSFORGE_API_URL`, `INSFORGE_ANON_KEY`, and `GITHUB_TOKEN` or GitHub App credentials.
- Optional/sponsor integrations: `SENSO_API_KEY`, `WUNDERGRAPH_API_URL`, `WUNDERGRAPH_API_KEY`, `GUILD_AI_API_KEY`, `SHIPABLES_API_KEY`, and Akash credentials.
- Keep secrets out of committed files and logs. Use existing redaction helpers in `packages/tools` when adding diagnostics.

## Product Invariants

- Preserve the evidence pipeline: live browser observation, structured artifact, dashboard display, verification proof, and PR evidence packet.
- TinyFish is the primary live-browser engine; Playwright is used for deterministic local/demo verification and fallback evidence.
- Redis streams, locks, retries, heartbeats, and dead-letter records are core state. Keep worker handlers idempotent and lock protected.
- InsForge is the durable system of record for runs, observations, artifacts, patches, and PR metadata.
- Use WunderGraph safelisted operations for controlled agent actions instead of arbitrary backend writes when a safelisted operation exists.
- Respect Guild.ai action gates before patch generation and PR creation paths.
- Query/use Senso policy context before final diagnosis or PR writing when that integration is available.

## Coding Conventions

- Keep changes scoped and aligned with existing package boundaries.
- Use `@flowpr/schemas` for shared data shapes instead of duplicating ad hoc types.
- Dashboard UI should feel like an operational command center: dense, scannable, and evidence-first. Follow the existing Radix/shadcn-style components, `lucide-react` icons, and Tailwind patterns.
- Keep Tailwind CSS on v3.4. Do not upgrade Tailwind to v4.
- Avoid committing generated build artifacts such as `tsconfig.tsbuildinfo` unless the task explicitly requires them.

# InsForge SDK Documentation - Overview

## What is InsForge?

Backend-as-a-service (BaaS) platform providing:

- **Database**: PostgreSQL with PostgREST API
- **Authentication**: Email/password + OAuth (Google, GitHub)
- **Storage**: File upload/download
- **AI**: Chat completions and image generation (OpenAI-compatible)
- **Functions**: Serverless function deployment
- **Realtime**: WebSocket pub/sub (database + client events)

## Installation

The following is a step-by-step guide to installing and using the InsForge TypeScript SDK for Web applications. If you are building other types of applications, please refer to:
- [Swift SDK documentation](/sdks/swift/overview) for iOS, macOS, tvOS, and watchOS applications.
- [Kotlin SDK documentation](/sdks/kotlin/overview) for Android applications.
- [REST API documentation](/sdks/rest/overview) for direct HTTP API access.

### 🚨 CRITICAL: Follow these steps in order

### Step 1: Download Template

Use the `download-template` MCP tool to create a new project with your backend URL and anon key pre-configured.

### Step 2: Install SDK

```bash
npm install @insforge/sdk@latest
```

### Step 3: Create SDK Client

You must create a client instance using `createClient()` with your base URL and anon key:

```javascript
import { createClient } from '@insforge/sdk';

const client = createClient({
  baseUrl: 'https://your-app.region.insforge.app',  // Your InsForge backend URL
  anonKey: 'your-anon-key-here'       // Get this from backend metadata
});

```

**API BASE URL**: Your API base URL is `https://your-app.region.insforge.app`.

## Getting Detailed Documentation

### 🚨 CRITICAL: Always Fetch Documentation Before Writing Code

InsForge provides official SDKs and REST APIs, use them to interact with InsForge services from your application code.

- [TypeScript SDK](/sdks/typescript/overview) - JavaScript/TypeScript
- [Swift SDK](/sdks/swift/overview) - iOS, macOS, tvOS, and watchOS
- [Kotlin SDK](/sdks/kotlin/overview) - Android and Kotlin Multiplatform
- [REST API](/sdks/rest/overview) - Direct HTTP API access

Before writing or editing any InsForge integration code, you **MUST** call the `fetch-docs` or `fetch-sdk-docs` MCP tool to get the latest SDK documentation. This ensures you have accurate, up-to-date implementation patterns.

### Use the InsForge `fetch-docs` MCP tool to get specific SDK documentation:

Available documentation types:

- `"instructions"` - Essential backend setup (START HERE)
- `"real-time"` - Real-time pub/sub (database + client events) via WebSockets
- `"db-sdk-typescript"` - Database operations with TypeScript SDK
- **Authentication** - Choose based on implementation:
  - `"auth-sdk-typescript"` - TypeScript SDK methods for custom auth flows
  - `"auth-components-react"` - Pre-built auth UI for React+Vite (singlepage App)
  - `"auth-components-react-router"` - Pre-built auth UI for React(Vite+React Router) (Multipage App)
  - `"auth-components-nextjs"` - Pre-built auth UI for Nextjs (SSR App)
- `"storage-sdk"` - File storage operations
- `"functions-sdk"` - Serverless functions invocation
- `"ai-integration-sdk"` - AI chat and image generation
- `"real-time"` - Real-time pub/sub (database + client events) via WebSockets
- `"deployment"` - Deploy frontend applications via MCP tool

These documentations are mostly for TypeScript SDK. For other languages, you can also use `fetch-sdk-docs` mcp tool to get specific documentation.

### Use the InsForge `fetch-sdk-docs` MCP tool to get specific SDK documentation

You can fetch sdk documentation using the `fetch-sdk-docs` MCP tool with specific feature type and language.

Available feature types:
- db - Database operations
- storage - File storage operations
- functions - Serverless functions invocation
- auth - User authentication
- ai - AI chat and image generation
- realtime - Real-time pub/sub (database + client events) via WebSockets

Available languages:
- typescript - JavaScript/TypeScript SDK
- swift - Swift SDK (for iOS, macOS, tvOS, and watchOS)
- kotlin - Kotlin SDK (for Android and JVM applications)
- rest-api - REST API

## When to Use SDK vs MCP Tools

### Always SDK for Application Logic:

- Authentication (register, login, logout, profiles)
- Database CRUD (select, insert, update, delete)
- Storage operations (upload, download files)
- AI operations (chat, image generation)
- Serverless function invocation

### Use MCP Tools for Infrastructure:

- Project scaffolding (`download-template`) - Download starter templates with InsForge integration
- Backend setup and metadata (`get-backend-metadata`)
- Database schema management (`run-raw-sql`, `get-table-schema`)
- Storage bucket creation (`create-bucket`, `list-buckets`, `delete-bucket`)
- Serverless function deployment (`create-function`, `update-function`, `delete-function`)
- Frontend deployment (`create-deployment`) - Deploy frontend apps to InsForge hosting

## Important Notes

- For auth: use `auth-sdk` for custom UI, or framework-specific components for pre-built UI
- SDK returns `{data, error}` structure for all operations
- Database inserts require array format: `[{...}]`
- Serverless functions have single endpoint (no subpaths)
- Storage: Upload files to buckets, store URLs in database
- AI operations are OpenAI-compatible
- **EXTRA IMPORTANT**: Use Tailwind CSS 3.4 (do not upgrade to v4). Lock these dependencies in `package.json`
