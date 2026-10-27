# Entitlement enforcement and usage limits

Status: **implemented and tested on the server.** Payment collection is still not
integrated (see §9) — plans are moved by the super-admin console, not by a
checkout.

Companion document: `SUBSCRIPTION_BILLING.md` (prices, lifecycle, control plane).

---

## 1. Architecture

```
                     config/plans.js                  (the only catalogue)
              plans · features · metric limits · plan version
                              │
                    services/featureCatalogService.js (global allowlist override)
                              │
                    services/subscriptionService.js   (row + derived status ladder)
                              │
                    services/entitlementService.js    ← THE decision point
                    getEntitlements / requireFeature / reserveUsage
                     ┌────────┴─────────┬───────────────┐
        middlewares/subscriptionMiddleware   orderService    controllers
             (HTTP gate per route)        (quota on every    (read for UI)
                                           order, all channels)
```

Three rules hold the design together:

1. **One decision point.** Entitlements are resolved only in
   `entitlementService`. Controllers do not each implement a subscription check;
   the middleware is a thin adapter over `requireFeature`.
2. **Server is the authority.** Nothing in the request body, query string or
   cookie is consulted for a plan, price, status, feature list or usage count.
   `cafeId` comes from the verified JWT via `tenantMiddleware`.
3. **Fail closed.** Unknown feature key → deny. Unresolvable subscription →
   degraded (core only). A database error inside a quota reservation → the
   operation fails rather than proceeding unmetered.

### Why a request gate is not enough

The order engine is called by the guest QR route, the POS checkout, the waiter
handheld — and any future surface. Mounting a quota middleware on one of them
would leave the others free. So the quota lives in `orderService.createOrder`,
which every ordering surface already funnels through, and the HTTP middleware
exists for the modules that only ever arrive over HTTP.

---

## 2. Feature → plan matrix

Keys are stable and never derived from display names. `features` gates
capabilities; `limits` gates volume.

| Feature key | Trial | Starter | Growth | Pro |
|---|:--:|:--:|:--:|:--:|
| `pos` (core) | ✅ | ✅ | ✅ | ✅ |
| `kds` (core) | ✅ | ✅ | ✅ | ✅ |
| `analytics` | ✅ | — | ✅ | ✅ |
| `reports.export` | ✅ | — | ✅ | ✅ |
| `loyalty` | ✅ | — | ✅ | ✅ |
| `coupons` | ✅ | — | ✅ | ✅ |
| `wallet` | ✅ | — | ✅ | ✅ |
| `invoices` | ✅ | — | ✅ | ✅ |
| `scratch` | ✅ | — | ✅ | ✅ |
| `reviews` | ✅ | — | — | ✅ |
| `nfc` | ✅ | — | — | ✅ |
| `geofence` | ✅ | — | — | ✅ |
| `digitization` | ✅ | — | — | ✅ |
| `support.priority` | ✅ | — | — | ✅ |

| Limit | Trial | Starter | Growth | Pro |
|---|---|---|---|---|
| `orders.month` | 500 | 500 | unlimited | unlimited |
| `outlets` | paid count | paid count | paid count | paid count |

`pos` and `kds` are **core**: they survive every state short of termination.
A café that cannot take money at the counter cannot pay us either.

### Subscription-state policy

| Derived status | Paid features | Core (`pos`, `kds`) | New orders |
|---|:--:|:--:|:--:|
| `trialing` | ✅ | ✅ | ✅ (quota applies) |
| `active` | ✅ | ✅ | ✅ |
| `grace` (7 days after period end) | ✅ | ✅ | ✅ |
| `degraded` (grace exhausted) | ❌ 402 | ✅ | ✅ (quota applies) |
| `cancelled` | ❌ 402 | ✅ | ✅ (quota applies) |
| `terminated` | ❌ 410 | ❌ 410 | ❌ 410 |

Status is **derived from dates at read time**, never written by a sweeper: a
`status` column would be stale for every tenant that crossed a boundary while the
process was down. `terminated` is the one stored, sticky state — a payment
webhook may not lift it.

---

## 3. Endpoint enforcement map

Every line below is mounted in the route file, not in the UI.

| Route | Gate |
|---|---|
| `GET /api/analytics/live` | *core* — the dashboard's operations tile |
| `GET /api/analytics/overview`, `/revenue`, `/gst`, `/items`, `/tables`, `/sessions`, `/customers`, `/payments`, `/peak-hours`, `/turnover`, `/outlets` | `analytics` |
| `GET /api/audit` | `reports.export` |
| `GET /api/billing/bills/export` | `reports.export` |
| `GET /api/billing/settlement`, `/sales-history`, `/analytics` | `analytics` |
| `GET /api/billing/bills`, `/bills/:id`, `/bills/search` | *core* — settling a bill |
| `/api/coupons/*` | `coupons` |
| `GET /api/customers/export` | `reports.export` |
| `/api/geofence/*` | `geofence` |
| `/api/invoices/*` | `invoices` |
| `/api/loyalty/*` (admin/POS) | `loyalty` |
| `/api/menu/digitize*`, `/dish-library` | `digitization` |
| `/api/nfc/manage*`, `/nfc/stats` | `nfc` |
| `/api/pos/*` | `pos` (core) |
| `/api/kds/*` | `kds` (core) |
| `/api/reviews/*` (admin) | `reviews` |
| `/api/scratch/*` (admin) | `scratch` |
| `/api/wallets/*` | `wallet` |
| `POST /api/orders`, `POST /api/pos/checkout`, `POST /api/pos/orders` | `orders.month` quota, reserved inside `orderService.createOrder` |
| `GET /api/subscription/entitlements` | authenticated tenant, read-only |
| `PUT /api/superadmin/cafes/:cafeId/entitlements` | super-admin (`superadmin` \| `support`), audit-logged |

Deliberately **not** gated, with reasons:

- **Guest menu, cart, ordering and bill preview.** A guest must never be blocked
  because the café's card failed. The one exception is a *terminated* café, whose
  orders are refused at the service level.
- **Public rating submission** (`POST /api/reviews`). No AI work happens on that
  path; it only captures feedback about a meal already eaten.
- **`GET /api/analytics/live`.** Today's revenue, active tickets and tables in
  service are how a café runs the floor, not a reporting product. Gating them left
  a Starter café's home screen reading "Live metrics unavailable", which looks
  like an outage rather than a paywall. Only the reporting endpoints are entitled.
- **NFC tap resolver** and **loyalty/wallet reads for an existing guest.** A
  sticker already printed on a table and stamps already earned keep working.
- **`GET /api/subscription/plans`** — public pricing page.

---

## 4. Usage metering

Collections (new, auto-created on first write):

- `usagecounters` — one row per `(cafeId, metric, periodKey)` with `used` and
  `reserved`. Unique index is load-bearing: it is what makes concurrent
  first-use upserts collapse to one row.
- `usageledgers` — one row per metered operation (`reserved` → `committed` |
  `released`), with a partial unique index on
  `(cafeId, metric, periodKey, idempotencyKey)`.

Lifecycle:

1. `reserveUsage` writes the ledger row (idempotency claim) and applies an atomic
   conditional update — `used + reserved + amount <= limit` is evaluated inside
   MongoDB, so N concurrent requests cannot all see "one left".
2. On success `commitUsage` moves `reserved` → `used`.
3. On failure `releaseUsage` returns the unit. `withUsage(fn)` does both
   automatically, including on exception.

Counting policy:

- `orders.month` — one unit per created order, whatever the channel. A retried
  request with the same `clientRequestId` is free (the ledger key is
  `order:<cafeId>:<clientRequestId>`).
- Period boundaries are **UTC calendar months**. UTC rather than the café's
  timezone on purpose: a commercial boundary that moves with a tenant-editable
  field is a support ticket at 00:00 on the 1st.
- `outlets` — a stock limit (`periodKey: 'lifetime'`), never resets.
- Unlimited metrics still record usage (the owner's usage report needs it), but a
  failure to write that counter is logged and non-fatal — an accounting write
  must not fail a customer's order.

---

## 5. Tenant isolation

- `cafeId` is taken from `req.user.cafeId` (verified JWT) by `tenantMiddleware`;
  no route takes a café id from the client for a tenant operation.
- `Subscription` has a unique index on `cafeId`; all tenant queries filter by it.
- Order idempotency lookups are scoped by `cafeId` — a request presenting another
  café's `clientRequestId` no longer receives that café's order.
- Per-tenant entitlement overrides are stored on that tenant's own subscription
  row and can only be written by the super-admin control plane.
- Outlet aggregation (`telemetryService`) re-verifies ownership before
  aggregating, so an `outletGroup` cannot be used to read another brand.

---

## 6. Overrides

`Subscription.entitlementOverrides[]`: `{ featureKey, enabled, note, grantedBy,
grantedAt, expiresAt }`.

- `enabled: true` grants a known feature the plan does not include (a comp).
- `enabled: false` **revokes** and wins over the plan (switch one module off after
  an abuse report without downgrading the customer).
- `expiresAt` bounds a grant in time.
- Unknown keys are rejected at write time rather than stored and ignored.
- A terminated tenant holds no features, overrides included.
- Every write is recorded in the hash-chained audit ledger with the operator's
  identity.

---

## 7. Caching and staleness

- Entitlements are resolved **per request** from the subscription row and the
  plan catalogue. There is no entitlement cache, so revoking or terminating takes
  effect on the next request — including for a JWT that is still cryptographically
  valid.
- The single-document `FeatureCatalog` (global allowlist) is cached in process and
  invalidated on every write. Maximum staleness = the lifetime of the process in
  a multi-instance deployment; a catalog edit is a rare, deliberate operator
  action and needs a restart (or an instance recycle) to fan out.
- The frontend receives its initial entitlement state from the server-rendered
  dashboard layout, then refreshes after a plan change. It never *decides*:
  editing that state changes only what is rendered.
- Pages whose whole purpose is a paid module (audit, coupons, loyalty, wallets,
  scratch, reviews, fraud watch, NFC, sales history) call `lib/planGate.tsx`
  **before** they fetch. Without that, a Starter café opening the URL directly got
  a 403 from the server component, which the page's `try/catch` turned into an
  empty screen and a stack trace in the server console — no data, no paywall, no
  explanation. The gate returns the upgrade panel instead, and the request is
  never made. It is still UX only: the route's `requireFeature` is the control.

---

## 8. Migration and rollback

### Migration

- **No backfill required.** `planVersion` and `entitlementOverrides` are additive
  with defaults; a row written before this change has neither field, and
  resolution treats a missing version as "current catalogue" and a missing
  override list as "none".
- `usagecounters` / `usageledgers` are new collections. Their unique indexes build
  on first connection (Mongoose `autoIndex`, unchanged from the rest of the app)
  and require nothing of existing data because the collections start empty.
- Existing subscriptions keep their `planKey`, dates and charged amounts exactly
  as they were. Nobody is repriced by deploying this.
- Repeatable: re-running the deploy is a no-op; no script writes tenant data.

### Plan changes (commercial)

`config/plans.js` holds `CURRENT_PLAN_VERSION` and `PLAN_VERSION_HISTORY`.
Changing a price or moving a feature between tiers:

1. Archive the current plan snapshot into `PLAN_VERSION_HISTORY[planKey][oldVersion]`.
2. Bump `CURRENT_PLAN_VERSION`.
3. New sales are stamped with the new version; existing subscriptions keep the
   snapshot they bought until someone migrates them deliberately
   (`activatePaidPlan` re-stamps).

The history is empty today because nothing has been re-versioned yet. The
resolution path exists and is exercised by
`__tests__/entitlement-service.test.js` (version stamping) so the first repricing
does not need a schema change under time pressure.

### Rollback

Revert the code. The new collections become inert, and the two new subscription
fields are ignored by the previous version. No destructive step, no data loss:
usage counters describe an allowance the old code never enforced.

---

## 9. Payment boundary (not implemented)

There is **no payment gateway integration**. `POST /api/subscription/checkout`
returns `503 PAYMENT_GATEWAY_NOT_CONFIGURED` rather than pretending to charge.

Consequences, stated plainly:

- A plan can only be activated by `PUT /api/superadmin/cafes/:cafeId/plan` (super
  admin) or by the server-side `subscriptionService.activatePaidPlan` call it
  makes. No browser request can do it.
- There are no webhooks, so there is no webhook signature to verify — and no
  forged-webhook test, because there is nothing to forge.
- When a gateway is added, the contract is: verify the provider signature on the
  raw body, verify merchant/account and plan context, process idempotently
  (provider event id), tolerate duplicates and out-of-order delivery, and call
  `activatePaidPlan` **only** from that verified path. A success-page redirect
  must never activate anything.

---

## 10. Environment variables

**None new.** The enforcement path uses the existing `MONGODB_URI`, `JWT_SECRET`
and `FRONTEND_URL`. No gateway keys exist or are read; do not add them to the
frontend bundle when they are introduced.

---

## 11. Tests

| Suite | Covers |
|---|---|
| `__tests__/entitlement-service.test.js` | plan matrix; unknown key denial; lapsed/terminated; overrides (grant, revoke, expiry, invalid key); quota counting, exhaustion, concurrency, idempotent retry, release on failure, period rollover, unlimited metrics; order-engine integration (charge, refusal writes nothing, no double charge, release on rejection, terminated café) |
| `__tests__/entitlement-enforcement.test.js` | over HTTP: 401 unauthenticated, 403 Starter on a Growth module, Growth allowed, client-supplied plan ignored, cross-tenant isolation, write module gated, 410 terminated, 402 lapsed, core retained, cafe token cannot write overrides, support grants/revokes a feature and the tenant's gate follows, usage payload has no billing secrets |
| `__tests__/subscription-lifecycle.test.js` | pricing arithmetic, date maths, state ladder (updated `hasFeature`) |
| `__tests__/subscription-service.test.js` | persistence, unique index, activation, cancellation, termination |
| `__tests__/super-admin-api.test.js` | control plane end to end |

The database-backed suites (all of the above) run against `mongodb-memory-server`;
database-free unit suites mock the models instead. Nothing in the suite touches a
real database.

---

## 12. Manual security checklist

Run against a staging deployment with two cafés (A: Starter, B: Growth) and a
super-admin account. Every step should produce the stated result; anything else
is a finding.

1. **No token.** `curl -H 'Authorization: ' /api/analytics/overview` → `401`.
2. **Wrong plan, direct API.** A's owner token → `GET /api/analytics/overview` →
   `403` `FEATURE_NOT_ENTITLED`.
3. **Client-supplied plan.** Same call with
   `?planKey=pro&features=analytics` and header `x-plan: pro` → still `403`.
4. **Write path.** A's token → `GET /api/coupons` → `403`.
5. **Cross-tenant.** A's token used against any of B's resource ids → `404`/`403`,
   never B's data.
6. **Frontend tampering.** In devtools, add `analytics` to the provider's
   `features` array → the page may render, but step 2 still returns `403`.
7. **Quota.** Push a Starter café to 500 orders in the month, then place one more
   from POS → `402` `QUOTA_EXCEEDED`, and no `Order` document is written.
8. **Concurrency.** Fire 10 parallel order requests at 499/500 → exactly one
   succeeds.
9. **Retry.** Re-send the same `clientRequestId` → same order returned, usage
   unchanged.
10. **Lapse.** Move `currentPeriodEnd` 40 days back → paid modules `402`, POS and
    KDS still `200`.
11. **Termination.** Terminate the café → every admin route `410` *and* a new guest
    order is refused.
12. **Override.** `PUT /api/superadmin/cafes/A/entitlements` granting `analytics`
    → step 2 becomes `200`; revoke → `403` again; check the audit ledger entry.
13. **Checkout.** `POST /api/subscription/checkout` → `503`, and the café's plan is
    unchanged afterwards.

---

## 13. Known limitations

1. **No online payments.** Entitlements are enforced, but a plan is bought by
   talking to QRDine staff. See §9.
2. **No outlet-creation endpoint exists**, so `assertOutletWithinLimit` is not
   mounted anywhere. The `outlets` count is still enforced on the *billing* side
   (what a café pays for) and via `Subscription.outlets`, but there is no request
   yet that could exceed it. Documented rather than claimed as enforced.
3. **`maxOrdersPerMonth` blocks ordering.** At the limit, a Starter café cannot
   take new orders until the next UTC month or an upgrade. This is a deliberate
   commercial limit (the alternative is a quota that does not exist), but it is
   the one place where a plan limit reaches a diner, so it should be reviewed
   before launch.
4. **`Order.clientRequestId` index is globally unique**, not per café. The lookup
   is now café-scoped, so a cross-café replay cannot read another tenant's order —
   but if two cafés happened to use the same id, the second insert would hit
   `E11000` (`409`) rather than creating its own order. Fixing that properly means
   a compound index and a migration; it is not done here.
5. **The global feature catalog** (`FeatureCatalog`) is one document for all
   tenants and its cache is per process — see §7.
6. **No staff-seat limit.** Plans do not define one, so none is enforced.
7. **Frontend lint is not clean** (`npm run lint` reports pre-existing
   `no-explicit-any` errors in `SettingsClient.tsx` and a `set-state-in-effect`
   error in `AdminSidebar.tsx`). `tsc --noEmit` and `next build` both pass, so the
   build is not blocked; the lint errors predate this work and were not introduced
   or silenced by it.
8. **Not covered by tests:** real gateway behaviour (none exists), multi-instance
   cache fan-out, and load/performance of the per-request entitlement resolution.
