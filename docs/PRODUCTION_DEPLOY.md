# Production deployment

Status: container, CI, environment contract and graceful shutdown are in place.
**The image has not yet been built or run end-to-end** — see "Unverified" below.

---

## 1. Hosting choice

Recommended for where you are now: **Docker image, hosted on Render's free
tier, with the frontend on Vercel's free tier.** Both are zero cost, and both
take the same Dockerfile/image you would deploy to Railway, Fly or a VPS later —
scaling up is a hosting change, not a code change.

### What "zero cost" actually means here

Free tiers are for staging, not for holding real customers' data. Be explicit
about the limits before you put a café on them:

| Limitation | Consequence |
|---|---|
| Render free spins down after ~15 min idle | First request after idle pays a cold start (~30s); **Socket.IO connections drop** when it sleeps, so a live KDS would silently disconnect |
| Render free has no staging→prod promotion | You deploy from a branch, not a promoted build |
| Atlas **M0 has no backups** (see `BACKUP_AND_RETENTION.md`) | Combined with a free tier that can be suspended, a customer could be deleted with no way back |
| Free tiers can be suspended for inactivity | A dormant tenant's data may be reclaimed |

**Recommendation:** run the free tier now for demo and pilot cafés, but do not
put paying customers on it until Atlas is M10+ and `scripts/backup.js` is on a
daily schedule. The billing work already built means a suspended service now
means *degraded paying tenants*, not just an inconvenience.

Frontend: Vercel free is fine and has no idle-timeout problem, since Next.js
serves static pages.

---

## 2. Environment contract

`backend/.env.example` is the authoritative list of every variable with
guidance. The server **refuses to start in production** on a missing or unsafe
value — those checks live in `backend/src/config/env.js` and are covered by
`__tests__/production-database-config.test.js` and
`__tests__/production-hardening.test.js`, so the validator and the docs cannot
drift apart unnoticed.

Production minimum:

```
NODE_ENV=production
PORT=5001
MONGODB_URI=mongodb+srv://USER:PASS@CLUSTER.mongodb.net/qrdine?retryWrites=true&w=majority
JWT_SECRET=<openssl rand -base64 48>     # ≥32 chars, no "change"/"test"/"dev"
FRONTEND_URL=https://app.example.com     # exact origin, https
FRONTEND_PUBLIC_URL=https://app.example.com
API_PUBLIC_URL=https://api.example.com
SENTRY_DSN=https://…@o0.ingest.sentry.io/…
LOG_LEVEL=info
```

`SENTRY_DSN` is a loud warning rather than a hard failure — but leaving it unset
means a customer reporting a failure cannot be diagnosed, which is the exact
situation error tracking exists for.

---

## 3. Deploying

### With Docker (local or any host)

```bash
cd backend
docker build -t qrdine-api:latest .

docker run -d --name qrdine-api \
  -p 5001:5001 \
  --env-file .env.production \
  --restart unless-stopped \
  --stop-grace-period 20s \
  qrdine-api:latest
```

`--stop-grace-period 20s` matters: the app drains connections on SIGTERM and
exits after 15s, so the default 10s would cut a graceful shutdown short.

### Socket.IO and proxies

If you sit behind nginx/Caddy/Cloudflare, WebSocket upgrade **must** be forwarded
or real-time order updates silently fail while everything else appears healthy:

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:5001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 600s;   # long-polling fallback; without it rooms drop
}
```

This is the single most common way a deploy looks fine and is not.

---

## 4. CI

`.github/workflows/ci.yml` — four jobs:

| Job | Runs | Gates deploy? |
|---|---|---|
| `backend` | full Jest suite | yes |
| `frontend` | `tsc --noEmit` + `next build` | yes |
| `route-contract` | `route-audit.js` | yes |
| `docker` | builds the image, asserts no `.env` inside it | yes |

The frontend `lint` step is **`continue-on-error: true`** and this is a known gap,
not an oversight: the frontend has ~370 outstanding lint problems, ~24 of which
are genuine React Hooks correctness errors. Gating CI on that today produces a
permanently red build that everyone learns to ignore, which is worse than no
gate. It should be flipped to blocking once the lint debt is cleared.

---

## 5. Observability

- **Structured logs** — one JSON object per line in production
  (`services/logger.js`), with `requestId`, method, path, status, duration,
  `cafeId` and `userId` per request. Every response carries `x-request-id`.
- **PII redaction** — applied twice, on the way into the logs (`redact`) and on
  the way out to Sentry (`scrubEvent`). Phone numbers, e-mails, passwords, OTP
  codes, cookies and guest tokens are masked. Tested by asserting on *absence*
  of those values, because a redaction test that only checks output is
  non-empty would pass while leaking every customer's phone number.
- **Sentry** (`services/errorTracking.js`) — optional and fail-soft. The SDK is
  loaded lazily, so no Sentry account means no dependency and no impact.

Grep a production failure by the request id the café reported:

```bash
grep '"requestId":"abc123"' app.log
```

---

## 6. Unverified — do this before trusting the image

1. **The Docker image has never been built.** Docker is installed on this
   machine but the engine was not running, so `docker build` was not executed.
   The CI `docker` job will be the first real build. The healthcheck command in
   the Dockerfile *was* tested directly against a live server (exits 0 when
   healthy, 1 when the port is dead), but the build itself is unproven.
2. **No deployment has been performed**, so nothing here has been exercised
   against real TLS, a real proxy or a real load balancer.
3. **Log shipping is not configured.** Logs go to stdout, which is correct for a
   container but means you need platform log retention — free tiers often cap it
   at a few days.
4. **No uptime/alerting on `/api/health`.** The endpoint exists and the
   container healthcheck uses it, but nothing pings you when it is down.