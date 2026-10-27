# syntax=docker/dockerfile:1
#
# QRDine API — production image.
#
# Multi-stage so the shipped image contains no devDependencies and no build
# toolchain. That is not only about size: `mongodb-memory-server` downloads a
# mongod binary, and a production image that can spin up a database on demand
# is a production image with a surprise in it.
#
# There is no build step — the backend runs TypeScript-free CommonJS directly —
# so "build" here means "resolve production dependencies".

# ── deps ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# `npm ci` (not `install`) so the image can only ever contain the dependency
# versions in package-lock.json. `npm install` silently upgrades within ranges,
# which means two builds of the same commit can differ.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# ── runtime ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# dumb-init reaps zombies and, critically, forwards SIGTERM to node. Without a
# real init as PID 1, Node receives SIGTERM directly but many orchestrators
# still send it to PID 1 — and a shell-form CMD that does not `exec` means the
# signal is swallowed and the container is SIGKILLed after the grace period,
# which is precisely the hard kill the graceful shutdown handler exists to avoid.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production \
    PORT=5001 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# `scripts/` ships too, and deliberately: `backup.js` is the operator's
# independent backup path and `create-superadmin.js` is how the control plane is
# bootstrapped. A production image that cannot take a backup is not deployable.
COPY scripts ./scripts

# `app.js` statically serves ../uploads for invoice PDFs. Create it as the
# unprivileged user so a fresh container has the directory and the right owner;
# in production it should be a mounted volume, not container-local storage.
RUN mkdir -p uploads && chown node:node uploads

# Run unprivileged. `node` (uid 1000) ships with the base image.
USER node

EXPOSE 5001

# The orchestrator uses this to decide whether to route traffic and whether the
# old container can be replaced. It hits the real database state, not a static
# 200, so a container that booted but cannot reach Atlas is reported unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5001)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# exec form + dumb-init so node is PID 1's child and receives SIGTERM.
CMD ["dumb-init", "--", "node", "src/server.js"]