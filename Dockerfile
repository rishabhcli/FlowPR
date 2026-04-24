# syntax=docker/dockerfile:1.7
# FlowPR production image — dashboard + worker share the runtime.
# Uses Chainguard Node images for SBOM-backed provenance.

FROM cgr.dev/chainguard/node:latest-dev AS builder
WORKDIR /app

# Copy manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY skills ./skills
COPY benchmarks ./benchmarks
COPY guild-agent.json ./

RUN corepack enable \
  && corepack prepare pnpm@10.0.0 --activate \
  && pnpm install --frozen-lockfile \
  && pnpm typecheck

FROM cgr.dev/chainguard/node:latest
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app /app

EXPOSE 3000

# Worker runs in the same container by default; override CMD to run only the dashboard or worker.
CMD ["node", "--experimental-specifier-resolution=node", "-e", "import('./scripts/start-runtime.mjs')"]
