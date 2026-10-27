# Subscription billing and the super-admin control plane

Status: pricing, lifecycle and enforcement are implemented and tested.
**Online payment collection is not.** See "Not built yet" at the bottom.

---

## 1. Plans

Defined once in `backend/src/config/plans.js`. No price, feature or limit is
duplicated anywhere else — controllers read from this table, and the frontend
gets it from `GET /api/subscription/plans`. Changing a price is a one-line edit.

| Tier | Monthly | Annual (2 months free) | Extra outlet / month | Orders / month |
|---|---|---|---|---|
| Trial | ₹0, 14 days | — | — | 500 |
| Starter | ₹349 | ₹3,490 | ₹149 | 500 |
| Growth | ₹499 | ₹4,990 | ₹199 | unlimited |
| Pro | ₹649 | ₹6,490 | ₹249 | unlimited |

All prices are **plus 18% GST**. GST is added at checkout against the café's
place of supply, so `GET /api/subscription/quote` returns `subtotalPaise`,
`gstPaise` and `totalPaise` separately.

**Money is stored in integer paise**, never rupees-as-float. `349` rupees is
`34900` paise. The rest of the codebase already settles money this way
(`orderService`'s `round2`), and binary floats cannot represent `0.1` exactly —
a café billed 0.1 too much, forever, is a support ticket.

**Annual = 10 × monthly**, asserted by test. Extra outlets get the same discount.

### Per-outlet pricing

The base price bundles **one outlet**. Each additional outlet is charged
separately on every plan, and `Subscription.outlets` is the single authority for
how many a tenant may run.

There is deliberately **no `multi.outlet` feature gate**. An earlier draft gated
multi-outlet to Growth/Pro *and* sold extra outlets on every plan, which would
have meant charging a Growth café for a second outlet and then refusing to let it
open one.

---

## 2. The expiry lifecycle

Your policy — *still active, then degrade, and the super admin can terminate /
block full access* — is a four-step ladder:

```
trialing ──trial ends (14d)──> grace (7d, everything still works)
                               └─grace ends──> degraded (paid modules locked)
active   ──period ends────────> grace (7d)
                               └─grace ends──> degraded
degraded ──super admin────────> terminated (everything locked)
```

**Status is derived, never stored as a fact.** `computeAccess(subscription, now)`
is a pure function of the row and the clock. Nothing runs at 00:01 on the expiry
date, so a stored status would be stale and wrong for every tenant that crossed
the boundary while the process was down. Deriving it means the answer is correct
at any instant, with no sweeper, no cron and no repair job.

### What degrading does and does not do

| State | Ordering / POS / KDS | Paid modules (loyalty, analytics, AI…) |
|---|---|---|
| trialing / active / grace | yes | yes |
| degraded | **yes** | no |
| cancelled | **yes** | no |
| terminated | no | no |

The café keeps taking orders and settling bills at every state short of full
termination. A café that cannot print a bill because our card failed is worse for
the café *and for its customers* — an expired subscription must never cost a café
its diners. `CORE_FEATURES` is never gated.

### Guest ordering is never gated

`requireFeature` is applied to the **admin** surface only. The guest app
(`/api/customer`) resolves its tenant from a table or session rather than a user
token and is deliberately not behind subscription middleware: a customer scanning
a QR sticker must always get a menu.

### Boundary semantics

The period-end instant is **inclusive** (`now <= paidUntil` is still active);
grace ends inclusively too. Grace is exactly `GRACE_DAYS` from `paidUntil`.

### Failure posture

- No subscription row → **degraded**, everything but core locked.
- A paid-plan row with no dates → **degraded** (cannot grant access on an
  unpayable subscription).
- `terminated` is terminal: a later payment updates the period but **cannot lift
  the ban**. Only an explicit reinstate does. The gateway saying "they paid" is
  exactly the signal that must not un-ban an account on its own.

---

## 3. API

### Tenant self-service — `/api/subscription`

`protect` + `tenantMiddleware`. There is no `:cafeId` in any path, so a token
cannot reach another café's billing.

| Method | Path | Notes |
|---|---|---|
| GET | `/plans` | public; the pricing page's whole data source |
| GET | `/` | current plan + live `access` |
| POST | `/quote` | `{ planKey, cycle, outlets }` → GST-exclusive and all-in |
| POST | `/checkout` | **503** — gateway not wired, see below |
| POST | `/cancel` | stops at period end; service continues |
| POST | `/resume` | undoes a cancellation |

All writes are CSRF-guarded, consistent with the rest of the API.

### Super admin — `/api/superadmin`

| Method | Path | Min role |
|---|---|---|
| POST | `/login` | public, rate-limited |
| GET | `/me`, `/overview`, `/cafes`, `/cafes/:id`, `/expiring` | any operator |
| POST | `/cafes/:id/plan`, `/cafes/:id/extend-trial` | `support` |
| POST | `/cafes/:id/terminate`, `/reinstate` | **`superadmin` only** |

`/overview` returns tenant counts by state and MRR. MRR counts **only**
active/grace tenants and is **GST-exclusive** — trials and degraded tenants are
not revenue, and the number you make decisions on should be the pessimistic one.

`terminate` **requires a reason** of at least 5 characters, and records
`lastChangedBy` / `lastChangeNote` on the subscription, so "why was this café
downgraded?" is answerable months later.

### Why there is no `cafeId` on `User`

A café admin is scoped to one tenant; a QRDine operator is scoped to none.
Two collections means the ordinary tenant middleware simply cannot address a
super admin:

- `protect` does `User.findById(decoded.id)` — a SuperAdmin lives elsewhere, so a
  super-admin token resolves to no user and is rejected.
- `protectSuperAdmin` requires `typ: 'superadmin'` **and** loads `SuperAdmin`, so
  a café owner's token is rejected.

One collection with a nullable `cafeId` would mean every existing query has to
remember to check it — and one missing `tenantMiddleware` becomes a cross-tenant
data leak. The `typ` claim is what stops a valid café token opening the control
plane; both directions are covered by tests that deliberately try to cross.

### Creating the first operator

There is no self-service super-admin registration.

```bash
SUPERADMIN_PASSWORD='...' node scripts/create-superadmin.js --email ops@qrdine.com --name Asha
node scripts/create-superadmin.js --email ops@qrdine.com --role superadmin --reset
```

With no password set, a strong one is generated and printed once (a password
typed into a shell history is a password that eventually leaks). Passwords under
12 characters are refused: this credential can terminate every customer.
Re-creating an existing email refuses unless `--reset` is passed.

---

## 4. Enforcing it on real routes

```js
const { attachSubscription, requireFeature } = require('../middlewares/subscriptionMiddleware');

router.use(protect, tenantMiddleware, attachSubscription);

router.post('/', validateCsrfToken, requireFeature(FEATURES.LOYALTY), createCoupon);
```

`attachSubscription` must come after `tenantMiddleware` (it needs `req.cafeId`).
Mounting `requireFeature` without it **fails closed with a 500** rather than
silently allowing the request.

Status codes are chosen so the frontend can tell the three failures apart without
parsing English:

| Code | Meaning |
|---|---|
| 402 | paid for, or past due → "settle your bill" (degraded) |
| 403 | plan doesn't include this → "upgrade" |
| 410 | terminated by us |

Nothing is wired up this way yet — the middleware exists and is tested, but
individual routers still need `requireFeature` added module by module. See
"Not built yet".

---

## 5. Not built yet

Stated plainly, because the API being reachable is easy to mistake for billing
being finished:

1. **Online payment collection.** `POST /checkout` returns
   `503 PAYMENT_GATEWAY_NOT_CONFIGURED` with the quote attached. No gateway is
   integrated, and no plan can actually be *bought* yet. This is deliberate: a
   stub that pretends to charge would leave a café believing it had paid with no
   record of the money. Needs a gateway + signature-verified webhook before
   `activatePaidPlan` is ever called from a request path.
2. **Renewal webhooks and dunning email.** `findExpiring({ withinDays })` exists
   and is tested, and is what a renewal-chase job or "your plan expires in N
   days" email would call. Neither is scheduled.
3. **`requireFeature` on existing routers.** The middleware is built and tested
   but not yet applied to the loyalty/coupon/analytics/NFC/review routes.
4. **Super-admin UI.** The control plane is an API only. There is no frontend
   page for it.
5. **Backfill for existing cafés.** `ensureSubscription` lazily creates a trial
   on first access, so legacy cafés are migrated as they are touched. Anything
   needing a *complete* list up front (e.g. a billing report across all tenants)
   should run a backfill script first.

## 6. Tests

```bash
npx jest __tests__/subscription-lifecycle.test.js   # pricing + ladder, pure, 31
npx jest __tests__/subscription-service.test.js     # persistence, in-memory Mongo, 16
npx jest __tests__/super-admin-auth.test.js         # privilege boundary, 19
npx jest __tests__/super-admin-api.test.js          # control plane over HTTP, 14
```