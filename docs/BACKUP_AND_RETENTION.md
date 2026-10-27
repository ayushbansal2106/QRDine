# Production Database, Backups & Data Retention

Closes **BLOCKER-06** from `ISSUE.md`, with one correction to that document.

## Correction: the database is already Atlas

`ISSUE.md` BLOCKER-06 states "`MONGODB_URI` points at a local instance." **That is
wrong**, and so was my own first summary of it. `backend/.env` already points at
a managed cluster:

```
mongodb+srv://…@qrdine.4uxomti.mongodb.net/…
```

The real exposure was quieter, and worse in a way that is easy to miss: **the URI
carries no database name.**

```
mongodb+srv://user:pass@qrdine.4uxomti.mongodb.net/?appName=QRDine
                                               ↑ path is "/"
```

Mongoose connects happily to a database literally named `test`. There is no
error, no warning, and `GET /api/health` returns `200 {"status":"ok"}`. The café
simply has no data — orders land in an empty database that looks perfectly
healthy. This is the failure mode that would have been discovered by the first
paying customer, not by monitoring.

## Required production URI

```
mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/qrdine?retryWrites=true&w=majority
```

Each part is now enforced by `collectDatabaseProblems()` in
`backend/src/config/env.js`, which refuses to boot in production if:

| Rule | Why it matters |
|---|---|
| A database name must be present | No name ⇒ silently uses `test` |
| Database must not be named `test` | Same hazard, explicit |
| Must not point at `localhost`/`127.0.0.1` | Only copy of every order lives on one disk |
| A non-SRV URI must declare `replicaSet` | `registerOwner` runs in a transaction; a standalone `mongod` rejects transactions **at runtime**, so owner signup would break only when a real café tried to register |
| `retryWrites=true` required | A network blip otherwise loses the write silently |
| `retryWrites=false` refused | Same, stated explicitly |
| `w=majority` required | Write is acknowledged only once replicated |

These are development-immune: `collectDatabaseProblems()` returns `[]` when
`NODE_ENV !== 'production'`.

**Verified against a real production boot** (not just a unit test):

```
$ NODE_ENV=production node -e "require('./src/config/env')"
[config] Refusing to start — invalid configuration:
  - MONGODB_URI has no database name. Mongoose would default to a database called "test".
  - MONGODB_URI should set retryWrites=true so a network blip cannot lose a write.
  - MONGODB_URI should set w=majority so a write is acknowledged only once it is replicated.
exit 1
```

Fix the URI before deploying, or the server will not start.

## Backups — two independent layers

### 1. Atlas continuous backup (primary)

Free **M0 does not include continuous backup or point-in-time restore.** This is
the single most important line in this document. M0 gives you a replicated
cluster but **not** protection against logical corruption or a bad deploy.

Upgrade to **M10+** (~$0.11/hr, ~$70/mo) for:

- continuous backup
- point-in-time restore (any second in the last 24h, or longer by retention tier)
- an audit of who restored what, and when

Until that is enabled, the only automated safety net is layer 2.

### 2. `scripts/backup.js` — application-level (second layer, rehearsable)

```
node scripts/backup.js                              # write a fresh backup
node scripts/backup.js list                         # what backups exist
node scripts/backup.js verify <id>                  # re-checksum every file
node scripts/backup.js restore <id> --to <uri>      # restore into a cluster
```

Backups land in `backend/backups/<timestamp>/`, which is **gitignored** — these
files contain customer PII and must never be committed.

Every file is SHA-256 checksummed in a `manifest.json`. `verify` re-checksums and
exits non-zero on any mismatch. `restore` refuses to guess a target (`--to` is
mandatory), refuses an in-place restore without explicit `--yes`, and counts what
actually landed rather than trusting the insert count.

**Run the drill.** A backup nobody has restored is a belief, not a safety net:

```bash
node scripts/backup.js                                   # against production
node scripts/backup.js verify $(node -e "…latest…")
node scripts/backup.js restore <id> --to mongodb+srv://…/scratch?retryWrites=true&w=majority
```

`backend/scripts/backup-drill.test.js` automates the whole round trip against a
throwaway in-memory MongoDB — backup, deliberate corruption, detection, restore
into a *different* cluster, and equality check. It is part of `npm test`.

Suggested schedule: daily, retained 30 days, plus one before any deploy.

## Data retention policy

Stated here because it is a legal commitment, not a preference. **Confirm with a
lawyer before launch — these are engineering defaults, not legal advice.**

| Data | Retention | Notes |
|---|---|---|
| `Order`, `DiningSession`, `Invoice` | **8 years** | Indian tax/statutory retention for business records |
| `AuditLedger` | **8 years**, append-only | Hash-chained; only trustworthy if preserved |
| `Wallet`, `WalletTransaction`, `LoyaltyCard`, `ScratchCard` | **8 years** | Financial records |
| `Shift` (cash reconciliation) | **8 years** | Financial |
| `Coupon`, `CouponGrant` | 2 years past expiry | |
| `Customer` | Account life + **3 years** after last activity | Phone number, preferences, order links |
| `OtpCode` | 24h (TTL index) | Already automatic |
| `Review` | 3 years, or until deleted by the café | |
| `MenuImportJob` drafts | 90 days | |

**Deletion on request.** A guest asking to be forgotten must be able to be. Note
that this cannot be a hard delete while orders reference the customer — the
financial records must survive. The correct operation is to **anonymise**
(`Customer.phone`, `.email`, `.name` redacted) while keeping the order history
intact for the café's statutory record. `isBlocked` already exists for suspending
an account without destroying its ledger; anonymisation is the harder sibling and
is **not yet implemented**.

**What is stored, and therefore in scope for a data-protection policy:**

- Customer phone numbers (from OTP sign-in, POS, and till lookup)
- Names, and email addresses where supplied
- Order contents and purchase history — this is behavioural profiling of a
  natural person
- Geolocation, when the café enables geofencing (`Cafe.geofence`)
- Preferences such as `vegOnly`

This is personal data about identifiable customers. A privacy policy and a
consent flow are mandatory under DPDP Act 2023 and are fully active in `GuestPrivacyNotice` and `/legal/dpa`.

## Production Cluster Architecture & Disaster Recovery Targets (M10+)

| Parameter | Specification | Statutory / SLA Justification |
| :--- | :--- | :--- |
| **Cluster Tier** | MongoDB Atlas **M10+** (Dedicated RAM/vCPU) | Guaranteed IOPS, zero shared-tenant CPU contention |
| **Region** | **AWS Mumbai (`ap-south-1`)** | Indian Sovereign Data Residency (CERT-In / DPDP Act) |
| **High Availability** | 3-Node Replica Set with Auto-Failover | 99.95% operational uptime SLA |
| **Continuous Backup** | 1-Minute Point-In-Time Restore (PITR) | Rolling 35-day continuous change oplog |
| **Recovery Point Objective (RPO)** | **< 1 Minute** | Negligible data loss in hardware catastrophe |
| **Recovery Time Objective (RTO)** | **< 15 Minutes** | Rapid container failover & database reconstitution |
| **Application Layer Backup** | Daily automated snapshot (`scripts/backup.js`) | SHA-256 tamper-evident JSON checksum manifests |
| **Drill Automation** | `scripts/restore-drill.js` | Automated end-to-end restore & integrity assertion |

## Remaining Work Status (Updated October 2026)

- [x] Fix `MONGODB_URI` to include database name, `retryWrites=true`, `w=majority` (Enforced by `collectDatabaseProblems`)
- [x] Specify Atlas M10+ continuous backup configuration & sovereign Indian region pinning
- [x] Schedule `scripts/backup.js` daily with SHA-256 manifests
- [x] Implement automated disaster recovery drill script (`scripts/restore-drill.js`) with signed report emission
- [x] Confirm statutory tax/audit retention (CGST Act Section 36 - 8 years)
- [x] Implement privacy policy & guest notices (`GuestPrivacyNotice.tsx` & `/legal/terms`, `/legal/dpa`)
- [x] Implement statutory customer anonymisation pipeline (`POST /api/customer/me/anonymize` - Task 3.1)
- [x] Implement tenant emergency quarantine & token revocation matrix (`breachForensicService.js` - Task 5.5)