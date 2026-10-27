# QRDine Production Deployment Checklist & Operations Guide

> **Target Release:** General Availability (GA) — Stage 7 Hardened  
> **Jurisdiction:** India (DPDP Act 2023, IT Act 2000 §79, CERT-In §70B(6), CGST Rules Rule 46)  
> **Topology:** Next.js Frontend + Clustered Node.js API + MongoDB Atlas M10+ (AWS Mumbai `ap-south-1`)

---

## 1. Pre-Deployment Configuration & Secrets

### 1.1 Production Environment Variables Reference

| Variable | Required | Production Guidance | Security Notes |
|:---|:---:|:---|:---|
| `NODE_ENV` | **YES** | `production` | Enforces TLS, disables stack traces, silences dev debug endpoints. |
| `PORT` | **YES** | `5000` (or `5001` per port allocation) | Application port managed by PM2/Docker. |
| `MONGODB_URI` | **YES** | `mongodb+srv://user:pass@cluster.mongodb.net/qrdine?retryWrites=true&w=majority` | Must use `mongodb+srv://` with TLS in production. Non-TLS connections are rejected at startup. |
| `JWT_SECRET` | **YES** | High-entropy string (`openssl rand -base64 48`) | Minimum 32 chars. Must never use defaults or contain "dev"/"test". |
| `PG_ENCRYPTION_KEY` | **YES** | 256-bit encryption key (`openssl rand -hex 32`) | Used for AES-256-GCM encryption of restaurant BYO Payment Gateway credentials. |
| `PG_ENCRYPTION_KEY_PREVIOUS` | *OPTIONAL* | Previous key during rotation window | Enables zero-downtime dual-key decryption during key rotation operations. |
| `FRONTEND_URL` | **YES** | `https://app.qrdine.com` | Primary customer & staff URL. Must be HTTPS. |
| `ALLOWED_ORIGINS` | *OPTIONAL* | `https://app.qrdine.com,https://admin.qrdine.com` | Comma-separated allowlist for multi-domain deployments. Validated for CORS and Socket.IO. |
| `API_PUBLIC_URL` | *OPTIONAL* | `https://api.qrdine.com` | Public canonical base URL for webhook callbacks and invoice generation. |
| `SENTRY_DSN` | **RECOMMENDED** | `https://key@o0.ingest.sentry.io/project` | Application error tracking. Automatically attaches request IDs and breadcrumbs. |
| `SENTRY_TRACES_SAMPLE_RATE` | *OPTIONAL* | `0.1` | 10% APM performance tracing sample rate. |
| `SMTP_HOST` / `PORT` / `USER` / `PASS` | *OPTIONAL* | Transactional mail provider credentials | Required for automated backup failure alerts and incident notifications. |

---

## 2. Infrastructure & Database Hardening

### 2.1 MongoDB Atlas M10+ Setup (AWS Mumbai `ap-south-1`)

1. **Sovereign Hosting:** Ensure cluster is provisioned strictly in AWS Mumbai (`ap-south-1`) to adhere to DPDP Act 2023 data residency and retention directives.
2. **TLS Enforcement:** Atlas enforces TLS 1.3 / 1.2 by default. `backend/src/config/db.js` validates TLS certificate authorities and logs the negotiated TLS cipher suite on connection (`SEC-101`).
3. **Network Access / IP Allowlist:**
   - Go to **Atlas Console** → **Network Access** → **IP Access List**.
   - **Delete `0.0.0.0/0`** (Allow access from anywhere).
   - Add only the static public IPs or CIDR blocks of your production API servers / load balancers.
4. **Point-In-Time Recovery (PITR):** Enable Continuous Cloud Backups with 1-minute PITR granularity in the Atlas Backup settings.
5. **Database Indexes:** Verify all tenant isolation compound indexes (`{ cafeId: 1, ... }`) are built. Run index health checks if needed.

### 2.2 Network & Reverse Proxy Configuration (Nginx / Caddy / Cloudflare)

Configure WebSocket support for Socket.IO real-time order fan-out:

```nginx
server {
    listen 443 ssl http2;
    server_name api.qrdine.com;

    ssl_certificate /etc/letsencrypt/live/api.qrdine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.qrdine.com/privkey.pem;

    # App REST API
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.IO Real-time Engine
    location /socket.io/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

---

## 3. Process Management & APM

### 3.1 PM2 Cluster Process Management

QRDine uses PM2 in cluster mode to utilize all available CPU cores with zero-downtime rolling reload:

```bash
# Start backend in production cluster mode
npm run start:prod

# View real-time cluster logs
npm run logs:prod

# Zero-downtime rolling restart (reloads workers sequentially without dropped connections)
npm run restart:prod

# Real-time resource monitor (CPU, heap memory, event loop latency)
npm run monitor

# Stop all workers
npm run stop:prod
```

### 3.2 APM & Monitoring Endpoints

- **Unauthenticated Health Probe:** `GET /api/health`
  - Returns `200 OK` (or `503 Service Unavailable` if database is disconnected).
  - Includes `backupVerification` status (`current`, `stale` if > 14 days, or `never`).
- **SuperAdmin Resource Metrics:** `GET /api/health/metrics`
  - Requires `Authorization: Bearer <superadmin_jwt>`.
  - Returns heap breakdown, CPU usage in microseconds, OS load average, active Socket.IO connections count, and MongoDB connection pool stats.
- **Sentry Verification:** In development/staging, test error reporting via `GET /api/debug-sentry`.

---

## 4. Operational Playbooks & Maintenance

### 4.1 Automated Backup Verification (Cron / Cloud Scheduler)

Automated backup drills run via `npm run backup:verify`, which verifies database integrity, executes a test restore into an isolated replica, and records an entry to `backups/verification-log.jsonl`.

**Crontab Setup (Weekly, Sunday at 03:00 IST):**
```bash
0 3 * * 0 cd /var/www/qrdine/backend && /usr/bin/npm run backup:verify >> /var/log/qrdine-backup-verify.log 2>&1
```

If the verification drill has not succeeded within 14 days, `/api/health` will automatically report `backupVerification: "stale"`.

### 4.2 Payment Gateway Secret Key Rotation SOP (SEC-105)

When rotating the AES-256 encryption key used for restaurant BYO Payment Gateway credentials:

1. **Step 1:** Generate a new 256-bit encryption key:
   ```bash
   openssl rand -hex 32
   ```
2. **Step 2:** Update environment variables on the production server:
   - Set `PG_ENCRYPTION_KEY_PREVIOUS` = `<Current_PG_Encryption_Key>`
   - Set `PG_ENCRYPTION_KEY` = `<Newly_Generated_Key>`
3. **Step 3:** Perform a zero-downtime rolling reload:
   ```bash
   npm run restart:prod
   ```
   *(Dual-key decryption is now active: existing credentials decrypt via previous key; any new credentials encrypt with the new key).*
4. **Step 4:** Execute the key rotation script:
   ```bash
   # Optional: preview rotation without writing
   npm run pg:rotate-key -- --dry-run

   # Perform atomic database re-encryption
   npm run pg:rotate-key
   ```
   *Expected Output: `N cafes re-encrypted, M fields rotated, 0 failures`.*
5. **Step 5:** Remove `PG_ENCRYPTION_KEY_PREVIOUS` from environment variables.
6. **Step 6:** Perform final reload:
   ```bash
   npm run restart:prod
   ```

---

## 5. Pre-Deployment Release Gate & Smoke Tests

### 5.1 Pre-Deploy Checklist

- [ ] All environment variables configured in production `.env` / secret manager.
- [ ] MongoDB Atlas IP allowlist verified (no `0.0.0.0/0`).
- [ ] Legal and tax agreements verified (Master SaaS Agreement, DPA, FSSAI Disclaimers).
- [ ] Run full test suite:
  ```bash
  cd backend && npm test
  ```
- [ ] Verify clean build of Next.js frontend:
  ```bash
  cd frontend && npm run build
  ```

### 5.2 Post-Deploy Verification Sequence

1. **Verify Health Endpoint:**
   ```bash
   curl -i https://api.qrdine.com/api/health
   # Expected: HTTP 200 OK, { "status": "ok", "database": "connected" }
   ```
2. **Verify CORS Lockdown (SEC-104):**
   ```bash
   curl -i -H "Origin: https://unauthorized-attacker.com" https://api.qrdine.com/api/health
   # Expected: Response does not include Access-Control-Allow-Origin: https://unauthorized-attacker.com
   ```
3. **Verify Webhook Rate Limiter (SEC-103):**
   ```bash
   curl -i -X POST https://api.qrdine.com/api/billing/pg/webhook/invalid-id-format
   # Expected: HTTP 400 Bad Request, "Invalid cafe identifier format" (no DB query executed)
   ```
4. **Verify Error Sanitization (SEC-102):**
   ```bash
   curl -i https://api.qrdine.com/api/orders/invalid-mongo-id
   # Expected: HTTP 400 Bad Request, { "success": false, "message": "Invalid resource identifier" }
   ```
5. **Verify Real-Time Socket Connection:**
   - Scan a live table QR code.
   - Place a test order and verify instant live appearance on Kitchen Display System (KDS) and Staff Dashboard with zero delay.
