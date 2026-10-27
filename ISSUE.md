# QRDine — Issue Register & Production Readiness Audit

**Date:** 2026-10-03
**Scope:** Full-stack defect scan of the 18-module CafeFlow build (backend + frontend), driven by four user-reported console/axios failures.
**Verified state at time of writing:** backend boots, **370 tests / 20 suites passing**, `tsc --noEmit` clean, `next build` clean, route audit passing.

---

## 1. Executive summary

Four symptoms were reported. They traced to **five distinct root causes**, three of which were silent data-loss/crash bugs and two of which were a single product-design gap (role-based navigation).

The good news: **no security hole was found and no tenant-isolation defect exists.** Every query is correctly scoped by `cafeId`, every protected write route is CSRF-guarded, and the permission model itself is sound. The failures were all in the *presentation layer* — the app was telling you to click things you weren't allowed to click, and crashing when it said no.

| Severity | Count | Status |
|---|---|---|
| P0 — silent data loss / total feature outage | 2 | ✅ Fixed |
| P1 — feature crash | 1 | ✅ Fixed |
| P1 — product gap (role-aware nav) | 1 | ✅ Fixed |
| P2 — hardening gaps | 3 | ✅ Fixed |
| P3 — launch blockers (see §5) | 6 | ⬜ Open — need decisions |

---

## 2. Fixed defects

### ISSUE-01 · P0 · QR codes never rendered
**Symptom:** `/admin/qr` cards stuck on "Loading…" / "Failed to load QR code". Every table.

**Root cause:** `backend/src/controllers/tableController.js:197`

```js
const { qrDataUrl } = await qrService.generateQrDataUrl(table.guestUrl);
```

`generateQrDataUrl` resolves to the data-URL **string**, not an object. Destructuring a string yields `undefined`, and `res.json()` silently omits `undefined` values — so the endpoint returned `200 OK` with **no `qrDataUrl` key at all**.

This is the worst class of bug: a success status code masking a total failure. It also meant the whole print/QR pipeline (download PNG, print card, bulk print) was dead.

**Fix:** take the string directly.
**Tests:** `backend/__tests__/table-qr-csrf.test.js` (5 cases).

---

### ISSUE-02 · P0 · Every write operation failed with 403
**Symptom:** *"CSRF token missing. Please refresh the page."* on table create, and on every other mutation.

**Root cause:** an origin mismatch in the double-submit cookie pattern.

The backend set `csrf_token` via `res.cookie()` — which can only ever set a cookie **on the backend's own origin** (`127.0.0.1:5001`). But Server Actions execute on the **Next.js origin** (`localhost:3000`), where that cookie did not exist. `cookies().get("csrf_token")` therefore always returned `undefined`, the header was never attached, and the backend rejected every POST/PUT/PATCH/DELETE.

A second, independent half: even with the header present, the backend's check compares the header against its own `csrf_token` **cookie**, and server-side axios does not forward cookies automatically.

**Fix (both halves):**
- `frontend/src/middleware.ts` — the Next.js origin now owns the cookie and mints it (32 random bytes, hex) when absent, on every admin/staff response including redirects.
- `frontend/src/lib/apiClient.ts` — forwards the token as **both** `x-csrf-token` and the `Cookie` header.

Security is preserved, not weakened: the guard still rejects no-token, header-without-cookie, and mismatched pairs. Verified live.

---

### ISSUE-03 · P1 · `/admin/reviews` returned 500 on every café
**Symptom:** `Request failed with status code 500` at `reviews/page.tsx:16`.

**Root cause:** `backend/src/controllers/reviewController.js` dereferenced `cafe.review.googleReviewUrl` directly. Any café created **before Module #18 shipped has no `review` subdocument**, so this threw `TypeError: Cannot read properties of undefined`. Because the page used `Promise.all`, the one failure took down all three parallel fetches.

The service already exported `getReviewConfig()`, which supplies defaults — the controller simply bypassed it.

**Fix:** read through `getReviewConfig`.
**Tests:** `backend/__tests__/production-hardening.test.js` (5 cases, including a café with no `review` key at all).

---

### ISSUE-04 · P1 · Sidebar offered every admin link regardless of role
**Symptom:** the 403 cluster on `getStaffUsers`, `/loyalty`, `/scratch`, `getBills`.

**Root cause — and the important clarification:** these 403s were **correct backend behaviour**. You were signed in as `staff@qrdine.com` (`Jatin`, role **cashier**), whose effective permissions are only `pos.use`, `order.view`, `order.status`, `drawer.open`. Every one of those endpoints is properly gated.

The real bug was the UI: `AdminSidebar` rendered a hardcoded list of **all 22 admin destinations** with no permission filter. A cashier was shown the entire admin menu — Settings, Audit Ledger, Fraud Watch, Reviews & AI — and every click was a guaranteed 403. The app was advertising capabilities the operator does not have.

**Fix:**
- `frontend/src/lib/permissionCatalog.ts` — frontend mirror of the backend permission strings.
- `frontend/src/lib/permissions.ts` — `ROUTE_PERMISSIONS` map + `canAccessPath()` (longest-prefix match).
- `frontend/src/lib/session.ts` — `getCurrentOperator()` reads `/auth/me` (which already returns effective permissions); `requirePathAccess()` guard.
- `AdminSidebar` now filters by permission; the dashboard layout resolves permissions once and passes them down.
- All 18 data-loading admin pages call `await requirePathAccess(...)` **before** any fetch, converting a 403 stack trace into a clean redirect to `/admin/orders?denied=1`.
- `OrdersClient` shows a dismissible "you don't have permission" notice so the redirect is never silent.

The backend remains the real enforcement point; this only stops the UI from offering what will be refused.

**Verified live against the running dev server:**
| Request | Result |
|---|---|
| owner → `/admin/scratch` | `200`, full sidebar + page |
| cashier → `/admin/scratch` | `307 → /admin/orders?denied=1` (no 403, no console error) |
| cashier → `/admin/loyalty` | `307 → /admin/orders?denied=1` |
| cashier → `/admin/orders` | `200`, sidebar shows only POS, Orders, Shift & Drawer |

**Note for developers:** run `npm run build` only when the dev server is stopped, or the production build overwrites `.next/` underneath the running dev server and the browser serves a stale bundle (the Next.js overlay reports this as `(stale)`).

---

### ISSUE-10 · P0 · A waiter-fired order could NEVER be settled
**Symptom:** waiter takes an order at the table → customer scans the QR → *"An active session is on this table, enter your name to join"* → customer joins → *"Only the table host can request the bill."* The table could order but could **never close its bill**.

**Root cause:** an asymmetry between the two ways a `DiningSession` is created.

| Path | Participants created |
|---|---|
| `createSession` (customer scans first) | one participant with `role: 'owner'` |
| `createWaiterOrder` (waiter fires the order) | **none — an empty roster** |

And `joinSession` hard-coded every new joiner to `role: 'member'`. So a waiter-opened session could **never acquire a host**, and `submitPayment` rejects anyone whose `participant.role !== 'owner'`. The customer was permanently dead-ended and the error message told them to ask someone who could not help.

**Fix — "first to claim an unhosted table becomes its host":**
- `joinSession`: if no *active* owner exists, the joining participant is created as `owner`, the session's `customerName` is realigned to them, and the handover is recorded on the activity feed + socket. This also covers the case where the original host walked out mid-meal.
- `submitPayment`: if a session somehow still has no active owner, the requesting member is promoted instead of being refused — a stranded table always has a way to settle. When an active owner *does* exist, the existing "host only" rule is untouched.

**Tests:** `backend/__tests__/session-host.test.js` (10 tests) reproduces your exact sequence — waiter-opened session with an empty roster, first joiner promoted, second joiner stays a member, rejoining does not duplicate or demote, a departed host is replaced, and a stranded table can pay.

---

### ISSUE-11 · P2 · Hardcoded colours blocked a safe theme swap
**Symptom (latent, not yet user-visible):** 61 hardcoded hex values were scattered across 17 components as Tailwind arbitrary values — `bg-[#e8f5e9]`, `text-[#2e7d32]`, `bg-[#6ffbbe]` and so on.

**Why it matters now:** the UI is being restyled. Every other colour in the app flows from `@theme` in `globals.css`, but a hardcoded hex keeps its old value forever. Changing the palette would have left success/warning/error/status colours in the *old* brand — a half-restyled UI, and exactly the kind of inconsistency that reads as "unfinished" to a paying customer.

**Fix:** added semantic status tokens to `@theme` (`success`, `warning`, `info`, `error-container`, `active-accent`, plus four one-off accent containers) and replaced all 110 arbitrary-value colour usages across 17 files with those tokens.

**Result:** `grep` for `[#hex]` in `frontend/src` now returns **0**. Every colour in the application flows from `globals.css`, so any future palette change is a single-file edit in one place.

**Codemod kept** at `backend/scripts/tokenize-hardcoded-colors.js` (supports `--dry`) so the tokens can be re-applied or extended later.

**Verified:** `tsc --noEmit` clean · `next build` compiled · 380/380 backend tests pass · tokens and their generated utilities verified present in the compiled CSS bundle.

---

### ISSUE-12 · P3 · Every upload left a copy behind in `uploads/temp`
`uploadImage` passed `req.file.path` to Cloudinary and then returned — the multer temp copy was never deleted. Success, validation rejection, unconfigured-Cloudinary 501 and SDK failure all left the file on disk, so `backend/uploads/temp` grows without bound over a café's lifetime.

**Fix:** the upload body is wrapped in `try/finally` with `cleanupTempFile()`, which unlinks `req.file.path` and swallows `ENOENT`. A cleanup failure is logged, never allowed to turn a successful upload into an error. The unused `path` require was dropped for `fs.promises`.

**Verified:** 6 regression tests in `backend/__tests__/upload.test.js` cover cleanup on all four paths plus the "cleanup failure must not mask success" case; orphan temp file removed.

---

### ISSUE-13 · P1 · The Gemini model this app depended on no longer exists
`GEMINI_MODEL` defaulted to `gemini-2.0-flash`. Google has retired it, so every AI menu digitisation call failed with `404 This model ... is no longer available`, surfaced to the client as `POST /api/menu/digitize 422`. Uploads worked; extraction never ran.

Worth noting why this was invisible until now: the module was only ever tested against a **mocked** Gemini, so the whole pipeline passed 29 tests while the model name it targeted had been dead in production.

**Fixed** to `gemini-3.8-flash`, chosen by probe rather than by copying Google's suggestion — the pipeline needs image input *and* `responseSchema` support *and* reasonable latency, and those don't move together:

| Model | Image + JSON | Latency |
|---|---|---|
| `gemini-3.8-flash` | ✅ | ~3.0s |
| `gemini-3.7-flash` | ✅ | ~3.7s |
| `gemini-3.6-flash` | ✅ | ~2.7s |
| `gemini-3.5-flash` | ✅ | ~19s |
| `gemini-3.5-flash-lite` | ✅ | ~2.3s |
| `gemini-2.5-flash` | ❌ 404 | — |
| `gemini-2.0-flash` | ❌ 404 | — |

**Guards added:** `backend/scripts/probe-gemini-vision.js` exercises the real service code path across candidates, and `backend/scripts/list-gemini-models.js` lists what the key can actually call. Re-run either after any model change. A retired model name is now a one-command check instead of a production 422.

**Also fixed:** Cloudinary's API key was scoped without the `create` permission, so uploads failed with `403 Request forbidden due to missing permissions (actions=["create"])` while every read call (`ping`, `config`, `tags`) succeeded. Cloudinary has migrated free accounts to a Roles and Permissions model, where the API key's role determines what it may do; the fix is granting the product-environment key a role that includes upload. `backend/scripts/diagnose-cloudinary.js` and `probe-cloudinary-upload.js` now surface Cloudinary's real error body, which the SDK otherwise discards in favour of `Server returned unexpected status code - 403`.

---

### ISSUE-14 · P2 · A transient Gemini 503 killed the scan outright
A single "503 ... high demand" from Google surfaced to the cafe owner as a dead digitisation job with the message "Menu scanning failed. Please try again." Peak service is exactly when Gemini throttles, so the most common transient fault was the one failure the app handled worst.

**Fixed** in `geminiService`: errors are classified as `transient` (503/429/high demand/network) / `retired` (404, model gone) / `fatal` (bad key). Transient errors get 2 retries with 400ms then 1200ms backoff; a retired model name skips straight to the fallback chain (`gemini-3.6-flash`, then `gemini-3.5-flash-lite`) instead of wasting retries; a fatal error aborts immediately because an invalid key cannot be fixed by changing model. Failures now return distinct reasons — `ai_throttled`, `ai_model_unavailable` — each with its own message for the owner ("Our AI service is busy right now. Please try again in a few minutes.") instead of one generic string.

**Verified:** 14 tests in `backend/__tests__/gemini-resilience.test.js`. Two of those caught a real defect during development — a fatal error was originally burning all three models, which the test now pins.

**Measured in production, not theorised.** With the same 88KB menu photo:

| Configuration | Outcome | Time |
|---|---|---|
| `gemini-3.8-flash` primary, 2 retries | `422` — whole chain throttled | 23.6s |
| 3 retries + 3 fallbacks | Succeeded on `gemini-3.5-flash-lite` | **78.9s** |
| `gemini-3.5-flash-lite` primary | Succeeded | **5.6s** |

The 78.9s run proved the fallback chain rescues a scan that used to fail outright — but it also proved that `gemini-3.8-flash` was returning "high demand" on *every* attempt. Repeated 503s on a fresh key point at Google's quota rather than transient load, so **check AI Studio usage/quota and that the Generative Language API is enabled and billed on the project**.

The chain is now ordered fastest-first (`gemini-3.5-flash-lite` → `gemini-3.5-flash` → `gemini-3.6-flash` → `gemini-3.8-flash`) so the common case is a ~5s scan and capability is only paid for when the fast model is throttled. Both flash-lite and flash produced the same 8 categories with identical prices from the live photo, so the speed preference cost nothing in accuracy.

The wait is no longer silent: `MenuDigitization.tsx` shows a running elapsed clock and escalates its copy at 15s and 45s (*"Our AI service is busy right now. We're still trying."*). `backend/scripts/probe-digitize-schema.js` reproduces any of this against the real photos in Cloudinary, reporting per-model outcome, latency, and the normalised result.

---

### ISSUE-15 · P1 · Hydration mismatch from browser-locale date formatting
**Symptom:** React recoverable error on `/admin/dashboard` — the server sent `Saturday, 3 October` and the browser produced `Saturday, October 3`, so React discarded the server HTML and rebuilt the tree on the client.

**Cause:** `new Date().toLocaleDateString(undefined, …)`. The `undefined` locale means "whatever this runtime's locale is" — the server's during SSR, the browser's during hydration. **Any owner whose OS locale differs from the server's hits this**, so it is not limited to the developer's machine.

**This was one bug in a class of thirteen.** A sweep found the same pattern in NFC stats and tag lists, waiter requests, reviews, cart activity, order tracking, and live telemetry. Six more in `OrderDetailClient` were already wrapped in `suppressHydrationWarning` — which hid the mismatch instead of fixing it.

**Fix:** added `frontend/src/lib/format.ts` with locale-pinned helpers (`LOCALE = "en-IN"`, `formatDate/formatTime/formatDateTime/formatShort/formatCurrency`), converted all call sites, and removed every `suppressHydrationWarning` from the order timeline. The dashboard header date is now formatted in `page.tsx` and passed down as a `todayLabel` prop, so the value cannot be recomputed differently on the client at all.

**Guard:** `backend/scripts/verify-locale-safe-dates.js` fails CI when any `toLocale*()` call omits its locale. Verified by negative test: a deliberately broken fixture is caught (exit 1) while `"en-IN"`, `LOCALE`, `d.toLocaleTimeString(LOCALE)` and nested-option forms all pass. The first two versions of this guard silently passed every violation — `indexOf('(')` matched the paren in `new Date()` rather than the call's own — so the negative test is what makes it trustworthy.

---

### ISSUE-16 · P0 · The AI digitisation schema was silently empty — the feature never worked
**Symptom:** every scan reported *"No dishes could be read from these photos"*, even on a clear, straight menu photo that an earlier probe transcribed into 8 categories without difficulty.

**Root cause:** `buildMenuSchema()` assembled its schema by calling `geminiService.buildSchema`, which only understands **flat** fields — lowercase `'string'`/`'number'`/`'array'` plus `itemsType`. The digitisation service passed Gemini's **native uppercase** types and nested objects, so:

- `mapType('ARRAY')` fell through to `default: OBJECT`
- `def.type === 'array'` was false, so no `items` was attached
- nested object definitions were ignored entirely

The schema actually sent was:

```json
{ "type": "OBJECT", "properties": { "categories": { "type": "OBJECT" } } }
```

Gemini complied perfectly and returned `{"categories":{}}`. `normaliseDraft` then found no `categories` array and dropped it. **The array type and all ~10 nested properties were gone.** This was the most severe defect in the register: not a regression, but a feature that had never functioned once.

**Why nothing caught it:** all 29 digitisation tests mocked Gemini, so they exercised `normaliseDraft` against hand-written fixtures and never inspected the schema that would actually be transmitted. A mocked test proves your parser; only a live call proves your request.

**Fix:** `buildMenuSchema` now builds the native recursive schema directly, with `required` lists on every level and `price` marked `nullable: true` so an unreadable price stays `null` (and gets flagged for the owner) instead of silently publishing at ₹0. `buildSchema` is left untouched for the review engine, which uses it correctly.

**Live result on the same photo that previously failed:** 8 categories, 43 items, 22 variants, 7 dish-library photo matches, 0 unpriced, in 9.7s.

**Guard:** `backend/__tests__/menu-digitization-schema.test.js` (8 tests) pins the schema's shape, including an explicit assertion that `categories` is an `ARRAY` and that it is not the degraded bare object. `backend/scripts/probe-digitize-schema.js` runs the real schema against the real photos and reports the model response, the normalised result, and any category that normalisation dropped.

---

### ISSUE-17 · P1 · Review screen was read-only for almost everything; menu published ₹0 and non-veg
Four separate defects, all on the path between "AI extracted the menu" and "owner publishes it".

**1. The review screen offered no controls.** Only dish name, base price and description were editable. `dietaryTags` rendered as a static `<span>` badge, `variants` as a text summary, and `gstPercentage`, `modifierGroups` and the category name were not rendered at all. An owner had no way to correct anything the AI got wrong.

**2. Every dish was published as non-veg.** The schema asked for a strict boolean ("true only if the menu explicitly marks the dish vegetarian"), so the model returned `false` for every dish whose veg symbol it could not see — and because `typeof false === 'boolean'` overrode the fallback, `guessDietary()` never ran. The safe heuristic already existed; it was unreachable. Measured on a live menu: 7/7 sampled dishes non-veg.

**3. Variants-only dishes would publish at ₹0.** With the price made nullable, the model became inconsistent about an unreadable base price: sometimes `null`, often a hard `0`. Since `publishDraft` only skips when `price === null && variants.length === 0`, every Chai S/M and Coffee S/M dish would have gone live costing nothing.

**4. Zero was treated as free.** `parsePrice` legitimately returns `0` for `0`. Normalisation now treats a `0` base price as unreadable, so it becomes `null` — which, with variants present, means the variants price the dish, and without variants means the item is flagged `needsPrice`, highlighted in review, and skipped rather than sold at zero.

**Fix:** the review screen now has a real Veg/Non-veg toggle, editable GST%, per-variant name/price inputs with add and remove, editable category names, remove-item, and add-on summaries. Both schema fields are `nullable: true` so uncertainty survives to normalisation instead of becoming a fabricated value.

**Live result on the same photo:** 8 categories, 43 items, 22 variants, 7 photo matches, 0 unpriced — chai/coffee/bites all correctly `veg`, and `ADRAK CHAI — variants [S:20, M:35]` with no phantom base price.

**Guards:** 15 tests in `backend/__tests__/menu-digitization-schema.test.js` cover schema shape plus the zero-price and dietary-fallback rules.

---

### ISSUE-18 · P0 · Publishing a digitised menu 500'd on the first photo-matched dish
**Symptom:** `POST /admin/menu 500 (Internal Server Error)` immediately after reviewing. That POST is a **Next.js Server Action** (`publishDigitizedMenu`), which rethrows the backend message — so the browser 500 was the *symptom*, and the real fault was a Mongoose validation error on the backend.

**Cause:** `MenuItem.media` was declared as `[{ url: { required: true }, caption }]`, but `publishDraft` wrote `{ type, dishKey, source: 'dish_library' }` — an entry with **no `url`**. Every dish that matched the dish library therefore failed validation with *"url is required"*, and because the loop had no per-item guard, the first such dish aborted the entire publish. With 7 photo matches on a live menu, the publish could never succeed.

**Why it survived the whole feature:** the digitisation tests mock `MenuItem`, so `MenuItem.create` was a jest function that accepted anything. No test ever ran the real schema against the object the service builds. This is the second time in this feature that a *request* was wrong while every *parser* test passed.

**Fix:** a media entry now needs **either** a `url` **or** a `dishKey`. `url` is optional, `dishKey`/`source` were added, and an array-level validator still rejects an entry with neither — so the real defect is not simply relaxed away. Consumers read `m.url` and `filter(Boolean)`, so key-only entries are skipped by the gallery rather than rendering a broken image.

**Hardened further:** publishing is no longer all-or-nothing. Each item is saved independently; failures are collected into `failedItems` and named in the owner-facing message (*"Published 42 items. 1 could not be saved: Paneer Tikka."*). Only a total failure — zero items created — marks the job failed and raises. A retry was already safe (the job stays `awaiting_review` and existing dishes are matched by name), so nothing needs cleaning up.

**Guards:** `backend/__tests__/menu-item-media.test.js` (6 tests) exercises the **real Mongoose schema** via `validateSync()`, needing no database. Verified against the original model: 4 of the 6 fail. Two more in `menu-digitization.test.js` pin the partial-failure and total-failure paths.

---

### ISSUE-19 · P0 · Coupon `appliesTo` scope was stored but never enforced
**Question that found it:** *"are the codes I create in admin applicable by customers and POS?"* The answer was **yes to the question of whether a code applies at all** — both the QR and POS controllers funnel through `orderService.createOrder`, which re-validates server-side. The defect was narrower and worse.

**Symptom:** a coupon scoped to specific items or categories discounted the **entire bill**. An admin creating "20% off Coffee" silently gave 20% off everything.

**Cause:** `Coupon.appliesTo` (`{ scope, itemIds, categoryIds }`) was accepted by `createCoupon`/`updateCoupon` and persisted by the schema — but `couponService.validate` never read it. `computeCouponDiscount` was handed the whole `subtotal`. The field was dead code that looked like a working feature.

**Fix:** `eligibleSubtotal(coupon, items, subtotal)` computes what the scope may discount. `all` keeps the whole subtotal; `items`/`categories` sum only the matching lines, and the discount is a percentage **of that eligible subtotal**. Flat coupons cap at the eligible subtotal rather than the basket, so a ₹150-off-coffee coupon cannot exceed the coffee lines. `minOrder` deliberately still checks the **full basket** — that is the customer-facing "minimum order value".

Two guards against the same silent failure: a scoped coupon with **no qualifying lines** is rejected (*"does not apply to anything in your order"*), and `validate` refuses to price a scoped coupon from a bare subtotal (*"must be checked against the cart"*) rather than falling back to the whole bill. `resolveLineItems` now returns `categoryId` per line so categories can be matched without a second query.

**ISSUE-20 · P1 · A bad guest coupon destroyed the whole order.** `validate()` threw *before* `Order.create`, so a guest who typed an expired code got an error **and lost their entire submission** — items, variants and notes. `createOrder` now takes `couponStrict`; the QR path degrades the failure to a `couponNotice` and still places the order at full price. The POS passes `couponStrict: true` so a cashier is told immediately rather than silently charging full. `redeem()` only fires when a coupon actually applied, so a rejected code no longer burns a use.

**ISSUE-21 · P1 · The customer was shown a total they were not charged.** Checkout had no discount line (`total = subtotal + totalGST`), while the backend charged `subtotal − discountTotal + totalGST`. The confirmation screen now renders the real `discountTotal` with its labels, and checkout states plainly that the figure is pre-coupon.

**ISSUE-22 · Documented behaviour did not match the code.** `docs/FEATURE_MODULES_PLAN.md` describes `POST /api/coupons/validate` as *"public, guest-token aware"*, but `couponRoutes.js` applies `protect` + `validateCsrfToken` router-wide, so it needs an admin JWT. **Left as-is by decision** — the endpoint stays admin-only. The consequence is that guests cannot preview a discount before ordering, which is why ISSUE-21 is resolved at the confirmation screen rather than by live preview. The endpoint now accepts optional `items` so an admin preview of a scoped coupon is priced against a real cart. The plan document is the thing that is wrong and should be corrected.

**Guards:** `backend/__tests__/coupon-scope.test.js` (8 tests) pins every scope path, and `backend/__tests__/coupon-qr-soft-fail.test.js` (4 tests) pins that an unknown code still creates the order without consuming a use, that an inactive code becomes a notice, that a valid one applies and redeems once, and that `couponStrict: true` still throws for the POS.

---

### ISSUE-23 · P0 · Every QR customer was permanently anonymous — the CRM could never fire
**Symptom:** a guest scans a table, orders, pays, and the next visit starts from zero. The admin CRM list stays empty, no loyalty card is ever issued, and `walletController` returns `wallet: null` every single time.

**Cause:** `Customer`, `customerService`, loyalty, wallet and the admin CRM screen were all built and all correct — but every one of them hangs off a single field that the guest app never populated. All three call sites are gated identically:

```js
// orderController.js / posController.js / waiterController.js
if (customerPhone) { customer = await customerService.upsertByPhone({ ... }); }
```

and **no QR screen ever collected a phone number**. `SessionGate` asked for name + email only, so `customerPhone` was always undefined on guest orders, `customerId` was always `null`, and the whole retention chain was unreachable. This also silently disabled the coupon `perCustomerLimit` added in ISSUE-19: it counts orders by `customerId`, which was always null.

**Fix — phone OTP identity (Module #09).** A new `OtpCode` model stores codes as a **salted SHA-256** (never plaintext) with a TTL index, an attempt budget and a resend cooldown; a wrong guess decrements the budget and a spent code is burned. Verification establishes an httpOnly `customer_token`, which is a deliberately separate identity from both the staff `protect` token (carries `typ: 'customer'`, so the two can never be confused) and the per-visit `guest_token`. `orderController` now links the order from the **verified token** rather than from anything the client sends, which is what finally gives orders, history, loyalty, wallet and per-customer coupons something to key on. `attachCustomer` is an *optional* middleware, so an anonymous walk-in still orders normally.

**Tenant isolation, caught in review:** the first draft of `verifyLoginOtp` looked the profile up by phone alone. `Customer` is keyed `{cafeId, phone}` — the unique index is per café — so the same person dining at a second café would have resolved to the **wrong tenant's profile and order history**. `cafeId` is now carried on the OTP record itself, required at request time, and part of the verification lookup, so a code minted for café A cannot sign a guest into café B.

**SMS is gated on DLT, by design of the regulations.** India requires an approved sender ID and DLT-registered template tied to business registration before any transactional message can be sent. `smsService` is therefore provider-agnostic (`SMS_PROVIDER=msg91`) and falls back to console mode outside production, where the code is logged and echoed in the response so the whole flow is testable today. **In production an unconfigured provider fails loudly rather than pretending to deliver a code** — otherwise the guest would see a success screen and never receive a message.

**Also in this pass:** `createSession` no longer requires an email (it can be attached later through the profile with its own email OTP), so email became genuinely optional; `Customer` gained `preferences` (`vegOnly` is honoured by the live menu), `emailVerifiedAt` and `isBlocked`/`blockedReason` for staff to suspend a profile without destroying its ledger; and `Coupon.appliesTo.customerIds` makes targeted offers real — enforced in `couponService`, with anonymous orders correctly refused.

**Guards:** `backend/__tests__/customer-auth.test.js` (21 tests) covers plaintext-never-stored, E.164 normalisation, superseding an older code, the attempt budget and lockout, expiry, single use, the cross-café refusal, all four targeted-coupon paths, and the `OTP_FIXED_CODE` rules below.

**`OTP_FIXED_CODE` — a pinned development code.** While no SMS provider is integrated, `OTP_FIXED_CODE=123456` pins every sign-in code so the flow is exercisable. This is an **authentication bypass**, not a test convenience: anyone who knows a customer's phone number can become that customer. It is therefore (a) refused outright in production — `collectConfigProblems` makes the process `exit(1)` rather than boot, verified with a real production-mode boot, (b) warned about loudly on every dev boot and on every code issued, and (c) never echoed back in the HTTP response, since the developer already knows it. Everything else is unchanged: the code is still salted-hashed, TTL-bound, cooldown-throttled and capped at 5 attempts, and the per-IP auth limiter still applies. **It must be deleted from the deploy environment before go-live.**

---

### ISSUE-24 · P0 · Every saved cart threw a hydration error on the menu
**Symptom:** scanning a table QR with items already in the cart produced `Hydration failed because the server rendered HTML didn't match the client`, with React regenerating the tree and the overlay reporting a stale Next.js build.

**Cause:** `cartStore` and `sessionStore` are Zustand stores wrapped in `persist`. On the server they are **always empty** — there is no `localStorage` — while on the client they rehydrate from browser storage *before* the first paint. Any markup derived from them therefore disagrees between the two renders. The reported diff (`aria-label="Cart, 1 item"` vs `"Cart, 0 items"`) was real, but it was only the **first** mismatch; React stops reporting once it finds one.

**Fixed throughout, not just at the reported site.** Every server-rendered value sourced from a persisted store now waits for rehydration via the new `useStoresHydrated()` hook:

- the header cart badge and the sticky-bar badge;
- `DishCard` — which swaps an ADD button for a quantity stepper, so **every dish in a saved cart** mismatched, not just the header;
- `SeatingCard` — "Bill raised" versus "Live"/"Scanning" is derived from the persisted `sessionStatus`.

Components that return `null` while closed (sheets, modals) were verified safe, as was `/cart/page.tsx`, whose `mounted` guard renders identical markup on both passes.

**Guard, and an honest note on its limits.** `backend/scripts/verify-persisted-store-hydration.js` asserts that the three known server-rendered components keep their gate. An earlier version tried to *detect* the defect generically and produced **eleven false positives**: static matching cannot distinguish `items` read from the store from `order.items` read from a prop, nor see that a closed sheet never reaches the server. Rather than ship a guard that always fails — which trains people to ignore it — it asserts the specific regression that occurred. It will not catch a newly added offender, and it does not claim to. Its self-test proves both the pass and fail branches fire.

---

### ISSUE-25 · P0 · Tapping "Profile" dropped a guest into the executive portal dashboard
**Symptom:** a customer tapped the person icon in the header and landed on the staff admin dashboard. There was also no sign-in page to reach in the first place.

**Cause — a three-hop redirect chain, each hop individually reasonable:**

```
CustomerHeader  →  /profile
/profile        →  not signed in  →  redirect("/")     ← the bug
/               →  redirect("/admin/login")
middleware      →  visitor has admin_token  →  /admin/dashboard
```

`/` is the **staff** entry point. Using it as the guest fallback meant anyone without a customer profile who followed a customer-facing link was silently redirected into staff authentication — and if they happened to hold a staff cookie, straight onto the dashboard. The fallback was written before the customer app existed, when `/` was the only sensible "go back" target.

**Fix.** A real sign-in page at **`/signin`**, plus a neutral guest landing page at **`/welcome`**, and every customer-facing fallback repointed at it:

- `/profile` and `/profile/orders` redirect to `/signin?next=…` instead of `/`;
- `ProfileClient` back, `SignOut` destination, `OrderHistoryClient` back, `SignInClient` back and the checkout empty-state all target `/welcome` (or the guest's own table when known);
- `/welcome` sends anyone who already has a table in their cart straight to the menu, and otherwise explains that ordering starts by scanning the table QR.

`/signin` accepts `?next=` but **only** same-origin paths — an unvalidated `next` is an open redirect, so `//evil.com` and absolute URLs fall back to `/profile`. It is also not a dead end: an already-signed-in visitor is forwarded on immediately, and *"Browse the menu without signing in"* is always available, because browsing must never require an identity.

**Note:** `/` was deliberately **left** redirecting to `/admin/login`. It is the staff entry point, and the middleware contract around it is relied on. The fix was to stop customer surfaces from using it as a fallback, not to repurpose the staff entry point.

**Also fixed while here:** `SignInClient` reads the persisted café id to decide whether to show the "open this from your table" warning. Reading it during render would itself have been a hydration mismatch (the exact ISSUE-24 class), so it is gated on `useStoresHydrated()` and added to that guard's assertion list.

---

### ISSUE-26 · P0 · Sign-in crashed the page, and even when it didn't, it could never complete
**Symptom (a):** `Runtime Error — Cannot read properties of undefined (reading 'hasHydrated')` on `/signin`.
**Symptom (b):** entering a mobile number, submitting the demo OTP, and nothing happens — the profile never appears.

These are **two independent bugs**, and (b) would have survived even if (a) were fixed.

**(a) — `store.persist` does not exist during server rendering.** Zustand's `persist` attaches `api.persist` only when a storage backend resolves. Its implementation is:

```js
if (!storage) { return config(...) }          // ← early return, line 346
...
api.persist = { hasHydrated, onFinishHydration, ... }   // ← line 440, never reached
```

There is no `window.localStorage` on the server, so `storage` is undefined, the function returns early, and `store.persist` is **never assigned**. Calling `useCartStore.persist.hasHydrated()` during SSR therefore throws and takes the whole page down — which is exactly why sign-in appeared to do nothing. `/checkout` carried the identical latent crash.

Verified against the installed source (`node_modules/zustand/esm/middleware.mjs`) rather than assumed.

**The fix has a second half that is easy to miss.** Even with a null-safe accessor, seeding hydration state from the stores is *wrong*: `localStorage` is synchronous, so on the client the stores are already rehydrated before the first render, and reading them there would make the client render differ from the server — reintroducing the ISSUE-24 mismatch. `useStoresHydrated` therefore starts at `false` on both server and client and flips inside an effect. One extra paint; no crash, no mismatch.

**(b) — the token was set on the wrong origin.** The backend set `customer_token` on the API origin, and a browser never presents an API cookie to the Next origin. So `/profile` — a server component reading that cookie — could not see it, redirected back to `/signin`, and the guest was trapped in a loop *even with a valid OTP*. `createSession` already solves this for the guest token by mirroring the cookie through `cookieStore.set`; sign-in never did. The token is now returned in the verify response and mirrored into an httpOnly cookie on the Next origin (and deleted from it on sign-out, or the guest stays signed in here after the API forgets them).

**Guard:** `verify-persisted-store-hydration.js` now also fails if **any** file reads `store.persist` directly. Negative-tested: introducing `useCartStore.persist.hasHydrated()` into a file makes it fail, and restoring it passes.

---

### ISSUE-27 · P1 · The profile preference switches were not usable
**Symptom:** the Veg only and Notifications switches on the profile screen did not behave like switches.

**Cause — three separate problems, none of them the colour of the track:**

1. **The tap target was 44×24.** The switch was its own small `<button>` sitting at the end of a non-interactive row. That is well under the 44×44 minimum touch target, so on a phone — a restaurant table, in fact — the setting was effectively unreachable. The label, description and icon were all dead space.
2. **The knob offset was wrong.** `translate-x-[22px]` from a `left` default of `0` put the knob 2px proud of the track's right edge, so the "on" state looked misaligned rather than seated.
3. **A stale rollback could silently undo a save.** The optimistic update captured `profile` in a closure and restored it on failure. Two quick taps meant the second rollback restored a snapshot taken *before* the first save landed — so the switch appeared to flip back on its own.

**Fix.** New `components/common/SettingsToggle.tsx`: the whole row is one `<button>` carrying `role="switch"` and `aria-checked`, with the track `aria-hidden` so assistive tech announces one control named after the setting instead of a nested widget. Knob travel is now symmetric (`left-0.5` + `translate-x-5` on a 44×24 track), with a focus-visible ring, an active-state press, and a `disabled` state while a save is in flight. Rollback reads the current profile from a ref rather than a captured snapshot, and a second tap on the same switch while it is saving is ignored.

**Backend, hardened in passing.** `updatePreferences` assigned straight onto `req.customer.preferences`, which is `undefined` for any profile stored before that field existed — a TypeError that surfaced as a failed save with the switch snapping back. The nested object is now created on demand. Values are also coerced with `Boolean()`, so a stringy payload cannot persist `"false"`.

**Guard:** `backend/__tests__/customer-preferences.test.js` (8 tests) covers both toggles, partial updates leaving the other setting untouched, string coercion, the missing-field repair, and the language refusal. Note the error path asserts on `next()` — these controllers are wrapped in `asyncHandler`, which forwards failures rather than rejecting.

---

### ISSUE-28 · P0 · Sign-in did not persist — every checkout asked again
**Symptom:** *"it again and again requires the signin, suppose i shift from /profile to table menu, and then again opens the profile, it asks for sign in, no session is stored, for every checkout the signin is needed, the previous signin does not work."*

**First, what was _not_ broken — because it is the obvious suspect.** The `customer_token` cookie was fine. Verified directly: the backend mints it with `HttpOnly; SameSite=Lax; Max-Age=2592000`; the `verifyLoginOtp` server action mirrors it onto the Next origin (`Set-Cookie: customer_token=…; Path=/; HttpOnly`); `/profile` returns **200** with it and **307 → /signin** without it; and `/profile → /table/{id} → /profile` stays 200 across all three hops with a cookie jar. Session persistence was working. Fixing the cookie would have changed nothing.

**The actual root cause: sign-in never asked for a name.** An OTP proves *who* you are; it never asks what to call you. A profile created by `verifyLoginOtp` therefore has `name: ""` — confirmed live. But the session gate's fast path is `if (customer?.name)`, so an empty name always missed it and fell through to the prompt. Because nothing ever wrote a name back, the prompt reappeared on **every checkout, forever**. The remembered name in `sessionStore` could not rescue it either, since sign-in populated it from the same empty profile.

**The second half made it worse than a repeated prompt.** In the name-only branch the gate rendered `PhoneOtpField` unconditionally and gated Continue on `!verifiedIdentity` — but `needsOtp` was already `false`, so `verifiedIdentity` was never set. **The button could never enable.** The guest was re-asked for an OTP they had already used, into a form that could not be submitted. That is the "previous signin does not work" half of the report.

**And a third defect would have silently defeated the fix.** The obvious repair — write the name to the profile — failed with `403 CSRF token missing`. The backend correctly enforces the double-submit check on `/api/customer/*`, but `frontend/src/middleware.ts` only minted the cookie under `/admin` and `/staff`. A guest who never opened the staff portal had **no CSRF token at all**, so `PATCH /customer/me` — and every preference toggle from ISSUE-27 — was rejected. Verified: a jar holding only `/welcome` + `/table/{id}` has zero `csrf_token` and gets 403; the same call after the matcher was widened returns 200. This is why the preference switches appeared to save nothing either.

**Fixes, all three:**
1. `SessionGate.startSession` persists the name with `updateProfileName()` when the guest was already authenticated, so the fast path finds it on every later checkout. `ensureSession` now falls back to `savedCustomerName` and treats a whitespace-only name as no name.
2. The `view === "form"` overlay renders `PhoneOtpField` only when `needsOtp`, adapts its heading and copy to the name-only case, and gates Continue on `needsOtp ? verifiedIdentity : true`.
3. The middleware `matcher` now also covers `/table`, `/cart`, `/checkout`, `/order`, `/profile`, `/signin` and `/welcome`, so a guest-only browser is issued a CSRF cookie. Scoped to routes that make state-changing calls rather than a blanket `/:path*`, to keep this off static assets.

The 403 was a **missing cookie, not a missing check** — `validateCsrfToken` stays on the customer routes and is asserted to stay.

**Guards:** `backend/__tests__/customer-signin-persistence.test.js` (10 tests) pins the guest-facing matcher entries alongside the staff ones, the profile-name write, the `needsOtp` conditions on both the field and the button, the absence of the old deadlocking `disabled` expression, and that CSRF enforcement remains on the route. Negative-tested: removing `/profile/:path*` and `/welcome` from the matcher, and un-gating `PhoneOtpField`, each fail the suite.

---

### ISSUE-29 · P0 · `max-w-md` meant 24px — every dialog collapsed to a sliver
**Symptom:** the POS "Take Payment" panel rendered as a narrow vertical column with its own text overlapping (`Order Total ₹360.00` printed on top of itself), the Cash/Amount/Add row spilling outside the panel, and Confirm/Print hanging in the catalogue grid behind it.

**Root cause — a theme collision, not a layout mistake.** The JSX was correct and always had been:

```jsx
<div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-md">
  <div className="... p-lg w-full max-w-md flex flex-col gap-md">
```

`globals.css` declares a custom spacing scale:

```css
--spacing-xs: 4px;  --spacing-sm: 12px;  --spacing-md: 24px;
--spacing-lg: 48px; --spacing-xl: 80px;
```

Tailwind v4 resolves a bare `max-w-<name>` against that scale, so the emitted stylesheet reads:

```css
.max-w-md { max-width: var(--spacing-md); }   /* 24px, not 28rem */
```

`w-full max-w-md` therefore capped the panel at **24px**, and `p-lg` (48px per side) pushed the content to ~120px wide — matching the screenshot. The children (`flex-1` inputs and buttons) then overflowed that 24px box, which is why text drew over itself.

**This was silent.** No type error, no console warning, and the JSX reads perfectly normally in review. It is only visible in the compiled CSS.

**Seven components were affected, not one:** POS item-detail **and** payment dialogs, toasts, the QR modal, geofence, customers, and the order-pipeline modal.

**A rejected first fix, recorded because the negative result is the useful part.** Adding `--container-sm/md/lg/xl` to `@theme` — which *should* be the container scale — had **no effect**: recompiling the real `globals.css` still emitted `max-width: var(--spacing-md)`. Tailwind prefers `--spacing-*` for `max-w-<name>` here. That was verified by compiling, not assumed, and the dead CSS was reverted rather than left behind looking like a fix.

**Actual fix:** pin an explicit length — `max-w-[28rem]` (448px), `max-w-[24rem]`, `max-w-[32rem]` — at all seven sites. Confirmed by compiling: `.max-w-\[28rem\] { max-width: 28rem; }`.

**Guard:** `backend/__tests__/max-width-token-collision.test.js` (5 tests) scans every `.ts`/`.tsx` in `frontend/src` for a bare `max-w-<spacing-token>`, asserts the premise (that `globals.css` still declares the colliding tokens, so it cannot pass for the wrong reason), and requires both POS dialogs to stay pinned. Negative-tested: reverting `ToastManager` to `max-w-sm` fails the suite.

---

### ISSUE-30 · P0 · POS accepted payment more than the order total
**Symptom:** the Take Payment dialog let a cashier tender ₹100 against a ₹90 order and show **Remaining ₹-10.00**. Confirming it marked the order paid and the surplus vanished.

**Root cause:** `recordManualPayment` guarded only the underpaid case.

```js
if (amountPaid + 0.001 < Number(order.totalAmount)) { throw ... }   // underpaid only
```

A surplus therefore flowed straight through. Each tender stored `change: Math.max(0, received - amount)`, and `received` defaults to `amount`, so **change was always 0** — the extra ₹10 was absorbed into `order.payments` with nothing recording it. A till is reconciled against recorded payments, so the drawer ends up out by that amount and no order explains why. It was not a display quirk; it was an unreconcilable cash discrepancy, reachable by a single mistyped amount.

**Fix.** Both totals are compared at paisa precision (`round2`), because summing split tenders accumulates float error — three tenders of ₹30 total `90.00000000000001`, and the previous `0.001` tolerance would have refused a payment that was exactly correct. Overpayment is now refused with an actionable message naming both figures, and nothing is written on the rejected path.

**Frontend, so the mistake is caught before Confirm.** `addTender` rejects an amount above what is still due and shows the same guidance inline. The Amount box is seeded with the outstanding balance and re-seeds after each tender — but only while the cashier has not typed into it, so manual entry is never fought. Once nothing is due the box clears, **Add** disables, and Remaining reads "Fully paid" rather than a negative rupee figure.

This matters more than it looks: placing an order pre-seeds a full tender (`setTenders([{ method: "cash", amount: total }])`), so Remaining is already 0 on open. Without the disabled state the natural next tap — adding a card tender for the same order — is precisely how the surplus arose.

**Also fixed in the same dialog:** the Cash / Amount / Add row overflowed the panel. Flex items default to `min-width: auto`, so the input refused to shrink and pushed **Add** outside the card. Fixed with `min-w-0` on the input plus `shrink-0` and a fixed width on the select and button. This was the same overflow visible in ISSUE-29's screenshot, now that the panel is correctly sized.

**Guard:** `backend/__tests__/pos-payment-amounts.test.js` (8 tests) — exact payment accepted; overpayment refused with **no** payment row written and the order left unpaid; split payment summing exactly accepted; a split payment whose *parts* each look valid but overshoot is refused (proving the check runs after summing); underpayment still refused; and both float-noise cases tolerated.

---

### ISSUE-31 · P0 · The POS created the order before it took the payment
**Symptom:** four separate reports traced to one cause — paid orders missing from the customer's order history, POS orders absent from the bills list, `/admin/sales` reporting nothing, and an abandoned payment popup leaving a ghost ticket on the orders board.

**Root cause:** the till had two write steps — `POST /pos/orders` then `POST /pos/orders/:id/payments`. Between them sat a window in which an order existed but was unpaid, and two separate bugs made that window visible and permanent:

```js
// recordManualPayment — sets paymentStatus, never touches status
order.paymentStatus = 'paid';
await order.save();          // status stays 'pending' forever
```

Every POS order therefore ended up `status: 'pending'`, `paymentStatus: 'paid'`. `getMyOrders` filtered on `status: { $in: SETTLED_STATUSES }`, so **no counter sale ever matched** — not in order history, not in the profile's order count, lifetime spend, or savings totals. If the cashier opened the dialog and then pressed Clear, the order was left behind on the orders board and the kitchen with no session and no revenue.

**Fix:** `POST /api/pos/checkout` does validation, creation and settlement in **one** request. The tender list is validated before anything is written, the order is created with `initialStatus: 'served'` (a counter sale is handed over at the till; it is not a pending kitchen ticket), and only then is it settled. The till now has exactly two outcomes: a settled order, or nothing at all. An idempotent replay returns the original order and **does not settle twice** — that would double-debit the wallet and stamp loyalty twice for one coffee.

Vouchers are resolved to a rupee value before the order is priced and folded into the discount list, since there is no longer an order row to apply them to afterwards.

**Frontend.** "Place Order" is now **"Take Payment"** and it only opens the dialog — it sends nothing. The dialog states plainly that no order is created until confirmation, **Confirm** stays disabled until the tender covers the total, and the controls collapse to **Print Receipt** / **New Order** only once the sale is confirmed. "Discard" dismisses with nothing saved. The coupon and loyalty voucher fields moved out of the post-order state into the cart, since both now travel with the checkout call.

**Also added:** `GET /api/customers/lookup?phone=` — an *exact* phone match for the till. `getCustomers` is a substring search across name/phone/email, so five dialled digits would match a dozen customers and leave the cashier guessing. A miss is the signal to create a new profile, which is then linked to the sale so the order appears in that customer's history when they later sign in with that number. Gated on `pos.use` **or** `customer.manage`, because a `cashier` holds `pos.use` but not `customer.manage` and is exactly the person who needs it.

**Guard:** `backend/__tests__/pos-checkout-atomic.test.js` (8 tests) — nothing written when the tender list is missing or malformed; order created `served` not `pending`; customer linked by phone; idempotent replay does not settle twice; dine-in requires a live table while takeaway requires none; a wallet tender with no customer behind it is refused without debiting.

---

### ISSUE-32 · P0 · Nothing ever closed a dining session, so sales history was empty
**Symptom:** `/admin/sales` showed no data for any range, including orders known to be paid.

**Root cause:** `getSalesHistory` filters `DiningSession { status: 'closed' }`, and the *only* thing that ever set `closed` was the payment pipeline. The café had 5 sessions — 4 `abandoned`, 1 `active`, **0 `closed`** — so the endpoint could only ever return empty. Separately, all 7 POS orders had `sessionId: null`, so even closed-session revenue would never have included a single counter sale.

**Fix, in two parts.**

*Take the counter's money too.* `getSalesHistory` now reads both sources — closed sessions **and** settled counter sales (`channel: 'pos', sessionId: null, paymentStatus: 'paid', status: { $ne: 'cancelled' }`) — and merges them into one chronological `entries` list, with the summary totalled across both. Paginating two sources correctly is done by over-fetching a `skip + limit` window from each, sorting by date and slicing. The summary uses grouped aggregations instead of the old unbounded `DiningSession.find(filter)`. Bills stay sessions-only, which is correct: a pending bill is a table awaiting payment, and a counter sale is already settled.

*Close sessions.* Three rules now:
- **Settling the bill** — already existed via the payment pipeline.
- **Manager manual close** — `POST /api/sessions/:id/close` (owner/manager). Unpaid orders **block** it, because closing a table with money still owed writes it out of sales history while the cash is still due. An explicit `writeOff` cancels those orders and records `session.closed_writeoff` in the immutable ledger.
- **Idle sweep** — a `setInterval` sweeper closes sessions idle for 10 minutes. Two hard limits: **empty sessions only** (a table with orders is live even if nobody has touched the app for ten minutes — guests are eating), and **never `bill_requested` / `awaiting_payment`** (a guest who asked for the bill is walking to the counter, and the app being quiet is exactly what that looks like). Swept sessions become `abandoned`, not `closed`, so a ₹0 session never pads the revenue report.

**Guard:** `backend/__tests__/session-lifecycle-close.test.js` (10 tests) — the sweep closes an empty table, leaves an occupied one alone however long it has been quiet, only ever considers `active`, honours the ten-minute window; manual close records totals, refuses to strand unpaid orders, writes off only on request and leaves a ledger trail, refuses an already-paid session, and is tenant-scoped.

---

### ISSUE-33 · P0 · A signed-in customer's order history was empty
**Symptom:** `/profile/orders` empty for a customer who had ordered.

**Root cause:** two compounding bugs.

```js
const SETTLED_STATUSES = ['confirmed', 'preparing', 'ready', 'served', 'completed'];
```

The `Order` model only ever sets `pending | accepted | preparing | ready | served | cancelled`. So **`confirmed` and `completed` could never match anything**, and **`accepted` was missing entirely**. Combined with ISSUE-31's paid-but-`pending` POS orders, the filter matched nothing at all — and the same clause drove the profile's order count, spend and savings, so all three were short by every counter sale.

**Fix:** `SETTLED_STATUSES = ['accepted', 'preparing', 'ready', 'served']` — only values the model can produce. Payment is the stronger signal, so a shared `settledOrderMatch()` now counts an order that is **paid** *or* in a real kitchen status: a counter sale is written settled, and a QR order can be paid while the kitchen is still on it. Either way the customer handed over money and expects to see it. Cancellations are excluded, or a voided order would be remembered as spend.

**Guard:** `backend/__tests__/customer-order-history-settled.test.js` (6 tests) — asserts every entry in `SETTLED_STATUSES` is a real model status and that the two invented ones are gone; a paid-but-`pending` order matches; cancelled never matches; the profile counters share the one definition; date-range filtering is unaffected. Negative-tested: restoring the old list fails the enum test, and removing the `paymentStatus` clause fails the other two.

---

### ISSUE-34 · P1 · A sparse unique index defeated by an explicit `null`
**Found by a live smoke test, not by the unit tests.** `Order.clientRequestId` is declared `unique: true, sparse: true` — orders without a client request id should not collide. But a sparse index only skips documents where the field is **absent**, and `createOrder` wrote `clientRequestId: clientRequestId || null`, making the field present-and-null on every such order. The second order created without an id then failed with `E11000 duplicate key error ... clientRequestId_1` and the insert was lost.

Any caller omitting the id — the waiter flow, and the new atomic POS checkout — could place only one such order per process lifetime before the till began erroring.

**Fix:** spread the field only when present. Omitting it is correct and needs no migration; changing the index would mean a drop-and-rebuild on every deployed database. (This is why `clientRequestId` stays optional in the checkout payload — the till sends one for replay safety, and the server no longer breaks when it doesn't.)

**Guard:** `backend/__tests__/order-client-request-id.test.js` (4 tests) — field absent without an id, present with one, POS orders born `served`, QR orders defaulting to `pending`.

---

### ISSUE-35 · P1 · `aggregate()` does not cast the tenant id — the summary silently read ₹0
**Symptom:** the sales rows rendered but **Total Revenue showed ₹0** with ₹1395 of real counter sales on screen.

**Root cause:** `Model.find()` casts its filter through the schema, but `Model.aggregate()` hands the pipeline straight to the server and casts nothing. `tenantMiddleware` supplies `req.cafeId` as a **string**, so `{ cafeId: '6ac08f5a…' }` inside `$match` matched no documents — and an aggregation that matches nothing is not an error, it is just zeros.

This is a nasty class of bug: the table is populated and correct, so it reads as a maths error rather than a query error, and unit tests with mocked models cannot catch it at all. Only running it against the real database surfaced it. `nfcService.getStats` already casts explicitly, so the fix follows existing convention in the codebase.

**Fix:** a `cafeObjectId()` helper in `billingController.js` used by both revenue aggregations. Audited the other `aggregate()` call sites — `analyticsController` filters on `sessionId` only, `customerAppController` uses an `ObjectId` read from the document, and `nfcService` already casts. This was the only affected caller.

**Guard:** `backend/__tests__/billing.test.js` — asserts both pipelines receive a real `ObjectId` matching the tenant. Negative-tested: removing the cast fails it. The fixture also had to be corrected to use a valid 24-character hex id, since `'cafe-001'` cannot be cast and would have made the suite pass for the wrong reason.

---

### ISSUE-36 · P0 · One person, two customer profiles — the cause of the "empty order history" report
**Symptom:** a customer who paid at the counter and then signed in with the same phone number saw an **empty** order history, even though the orders were in the database, correctly linked.

**Root cause:** three code paths key a customer profile by phone, and they disagreed about the *form* of that phone.

```
OTP sign-in -> smsService.normalizePhone() -> "919996696235"
POS (CRM)   -> (phone || '').trim()        -> "9996696235"
till lookup -> exact match on the raw string
```

So one person got two profiles: the counter sale sat on the POS profile, and signing in created a different, empty one. Confirmed in the data — `Ayush` (9996696235, 4 orders) and an unnamed profile (919996696235, 0 orders) were the same person.

**Fix:** `customerService.canonicalPhone()` is now the single source of the canonical form, used by `upsertByPhone`, the till lookup **and** OTP sign-in. `findByPhone()` resolves either form and *heals* a legacy row to canonical in place, so the split cannot recur. It deliberately prefers the canonical profile over merging two real profiles — merging belongs to a repair script, not a read path.

**Data repair:** `backend/scripts/repair-customer-phones.js` (supports `--dry`). It heals rows with no counterpart, merges when the canonical row has no *live* orders, and **refuses** to guess when both sides have real history. The live-order test excludes cancelled orders deliberately — a voided ₹200 QR draft is a leftover of the same broken flow, not a competing visit history.

**Guard:** `backend/__tests__/customer-phone-canonical.test.js` (14 tests) — negative-tested.

---

### ISSUE-37 · P0 · "Resend invoice" reported success without sending anything
**Symptom:** press Resend invoice, see a success message, no email arrives.

**Root cause:** `resendInvoiceEmail` addressed the mail to `session.customerEmail` and nothing else. That field is only populated when a guest typed an email at the table, so for many bills it was empty — and the endpoint returned `200 { emailSent: false }`, which the UI read as a completed resend.

**Fix.** A verified profile email is now a legitimate recipient, so a customer who gave their email to the cashier or verified it at sign-in can still be reached. An *unverified* profile email is deliberately not used — an invoice is a legal document and must not go to an address nobody proved they own. "Nobody to send to" is now a **409**, not a 200-with-a-failure-flag, so the caller can prompt for an address instead of showing an error nobody can act on. A staff-supplied address is persisted to the profile and the session, making the prompt a fix rather than a repeated chore.

**Guard:** `backend/__tests__/invoice-resend-recipient.test.js` (8 tests) — negative-tested both halves.

---

### ISSUE-38 · P1 · Wallet, loyalty, scratch cards and coupons existed only in the admin panel
**Symptom:** the customer profile showed no stamps, balance, cards or offers — and it looked like the rewards were not being awarded at all.

Two separate things, one true and one false:

- **Not rewarding: correct behaviour.** The café's `LoyaltyProgram` exists but has `isActive: false`, so `earnStamps` returns early and no card is created. There is no `ScratchCampaign`, and wallets only appear on first top-up. Switch the programme on in the admin panel and stamps start landing.
- **Not visible: a real gap.** All the services existed, but the only customer-facing routes resolved identity through a *dining session's* guest token and then looked for an order on that table. A guest who signed in with their phone number — the profile the app actually builds — had nowhere to look.

**Fix:** `backend/src/controllers/customerRewardsController.js` adds `GET /customer/me/{loyalty,wallet,scratch,coupons}` and `POST /customer/me/scratch/:id/reveal`, all behind `protectCustomer`. Tenant comes from the profile document, never from the request. An unrevealed card never carries its prize in the payload. Each card states *why* it is empty — "no programme", "programme not running", "no campaign" are three different situations and a bare "—" reads as all three meaning "you are being short-changed".

**Frontend:** a `RewardsSection` inline on `/profile`, below order history. Scratch cards are revealable.

**Guard:** `backend/__tests__/customer-rewards-surface.test.js` (9 tests) — negative-tested.

---

### ISSUE-39 · P0 · The table host could not request the bill, and the bill showed ₹0
Two independent faults on the same journey.

**39a — the guest's identity was never sent.** `submitPaymentPreference(sessionId, method)` posted `{ paymentMethod }` and nothing else. The backend needs `participantId` to answer the only question that matters — *is this person the table host?* — so it searched for a participant whose id was `undefined`, found none, and refused with a 403. Verified live against the running app:

```
no participantId (frontend today) -> 403 You are not a participant in this dining session
with the host's participantId     -> 200 status=awaiting_payment
```

Behind that sat a second fault: `createSession` returns a **flat** session summary (`participantId` and `role` at the top level), but `SessionGate` read `session.participants[].deviceId` — an array the response does not contain. So on the create path the store was left holding `participantId: undefined`, and there was nothing to send even once the action was fixed.

**39b — the bill showed ₹0 while food was in the kitchen.** Seven independent copies of this loop:

```js
if (item.status === 'served' || order.status === 'served') {   // count it
  if (item.status !== 'cancelled') { subtotal += ...; gst += ...; }
}
```

A table that had just ordered ₹280 of food showed a running total of **₹0** on the bills board — and then the payment pipeline charged the same ₹0. A bill that reads zero while the kitchen is busy is not a conservative estimate, it is a wrong number.

**Fix.** One shared helper, `orderService.sumBillableItems()` / `isBillableItem()`, now used by all seven sites: the bills dashboard, the guest's bill preview, the bill request, the adjustment guard, the payment pipeline, the manual close, and sold-item analytics. Only genuinely withdrawn lines are excluded — `cancelled` and `partially_cancelled`. A missing item status counts as billable, so legacy rows cannot silently zero out.

**A test that encoded the bug was rewritten.** `billing.test.js` had `should calculate running total from served items only`, which asserted the ₹0 behaviour. It is now `should bill for food that is still in the kitchen`, paired with `should not bill for items withdrawn mid-service`.

**Guard:** `backend/__tests__/guest-bill-request-identity.test.js` (11 tests) — host accepted, member refused, missing identity refused, hostless session promoted, and the full billable contract — negative-tested.

---

### ISSUE-40 · P0 · `orderService is not defined` killed every bill settlement — and stranded the table
`backend/src/services/paymentPipeline.js` priced the table with the new shared helper but never imported it:

```js
const { subtotal, gst: totalGST } = orderService.sumBillableItems(orders);  // no require
```

CommonJS does not fail at load time — it fails the first time that line runs, which is step 2 of `executePaymentPipeline`. So the moment anyone settled a bill (`POST /api/bills`, mark-paid, POS checkout) the pipeline threw a `ReferenceError` and returned 500. Two visible symptoms, one cause:

- `POST /admin/bills 500 — orderService not found`
- **No stamp on QR orders.** The loyalty, wallet, CRM-visit and scratch-card steps all sit *after* the total is computed, so settlement never reached them. A QR visit that satisfied every rule of the programme (active programme, ₹280 ≥ ₹249 minimum, `qualifyingScope: all`) left the card unchanged.

`billingController`, `sessionController`, `posController`, `orderController` and `waiterController` had the same call and *did* require the module, which is why only settlement broke while every read-only bill screen kept working — and why it looked like a loyalty bug rather than a crash.

**Fix.** Added `const orderService = require('./orderService');` to `paymentPipeline.js`. A one-off static sweep of every file under `backend/src` — flag any module name used as `name.…` but never imported or declared — now reports nothing, so the whole class of fault is closed rather than this one instance.

**40b — a failed settlement stranded the table forever.** Step 1 takes an atomic lock (`status → processing`) so two clicks cannot settle the same bill twice. Nothing released it on failure: any throw after the lock left the session in `processing`, which is in *no* bills-dashboard filter (`active` / `awaiting_payment`) and matches *no* retry (`$in: [active, bill_requested, awaiting_payment]`). The table vanished from the board and every retry answered *"Session not found or already paid/closed/processing"* — the crash was permanent, not transient. **The lock is now taken with `new: false`** so the displaced status is known, and the whole body runs inside a `try/catch` that restores it before rethrowing. The one hardcoded `status: 'active'` revert (empty-session case) was folded into the same path.

**Verified live** on session `6ac116d7` (ORD-20261003-0015, ₹280, programme active, `qualifyingScope: all`, min ₹249): settled at **₹280** — not ₹0, not a 500 — invoice `INV-20261003-0001` generated, session closed, card went 6 → 7 lifetime stamps and crossed the 5-stamp threshold, issuing voucher `RWD-780391`.

**Guard:** `backend/__tests__/payment-pipeline-settlement.test.js` (5 tests) — a QR session with a **pending** (still in the kitchen) line is priced at ₹142.76, `earnStamps` is called for that customer, the module is asserted to be imported and used, and two negative tests assert a mid-pipeline failure releases the lock to the *displaced* status rather than a hardcoded one — negative-tested.

---

### ISSUE-41 · P1 · A lock held by a dead process could never be released
40b fixed the in-process failure path, but a process that *dies* mid-settlement (deploy, crash, OOM) still takes the `processing` lock to the grave: nothing in the running app threw, so nothing rolled it back, and the next boot found a table that no screen lists and no button can retry.

**Fix.** `releaseStuckSessions()` in `sessionLifecycleService` reopens any session left in `processing` for more than `PROCESSING_STALE_MINUTES` (2 min — comfortably longer than a real settlement, whose slowest part is the best-effort PDF), restoring the status it displaced, inferred from the one signal that survives the crash: a guest who already chose a payment method (`paymentMethod: 'pending'`) goes back to `awaiting_payment` at the counter, everyone else back to `active`. Each flip is conditional on the session still being `processing`, so a settlement that completes while the sweep is reading cannot be knocked back after its money has been taken. `startSessionRecoverySweeper()` runs it at boot (after `connectDB`, before the first request can arrive) and then every minute as cheap insurance; it writes a `session.recovered` ledger entry and tells the session room.

**Guard:** `backend/__tests__/session-processing-recovery.test.js` (8 tests) — nothing to do when no lock is held, the grace window is honoured, a guest who chose a method returns to the counter queue, a mid-meal table returns to `active`, a session that settled mid-sweep is left alone, the recovery is audited and broadcast, and only statuses the pipeline accepts again are ever restored — negative-tested.

---

### ISSUE-42 · P2 · The till could not see the loyalty card it was about to move
A stamp is awarded when a bill settles, and a voucher sitting on a guest's card is a discount the cafe has already promised. Both were invisible at the counter: the cashier took payment without knowing the visit was one stamp from a reward, or that the guest was holding a voucher they intended to use on that very bill.

**Fix.** `getBills` now carries a compact loyalty snapshot per row (stamp progress, stamps to the next reward, and **only** `active` vouchers — an expired one on screen is an offer that cannot be honoured), resolved in one batched query scoped to the cafe and the guests actually on the board, never one query per table. New `GET /api/billing/bills/:id` returns one table in full — orders with their cancellation state, subtotal/GST/adjustments/total on the same shared billable arithmetic as the guest's preview, and the same loyalty snapshot — and opens a **Details** modal on the bills board. The board also listens for `loyalty-updated`, so a stamp awarded anywhere in the cafe cannot leave a stale count on screen.

**Guards:** `backend/__tests__/bills-loyalty-surface.test.js` (6 tests) — stamp progress on the row, expired and redeemed vouchers dropped, a table with no signed-in guest reports `null` and skips the lookup entirely, the lookup is tenant-scoped, the detail returns orders + total + card together, and another cafe's session is a 404 — negative-tested.

---

### ISSUE-43 · P1 · A completed stamp card had nowhere to go
Two gaps made the stamp loop end in nothing. Stamps that cross the threshold while a bill settles convert automatically, but a card that reached the threshold any other way — a manager's goodwill adjustment (which never mints anything), or a programme switched on after the stamps were earned — sat at `5 / 5` with a "reward ready" message and no way to collect it. And even with a code, it could only be spent at the counter: `orderService` and `couponService` knew nothing about vouchers, so a guest earned at the table and had to come back to a till to spend it.

**Fix.**
- `loyaltyService.claimReward()` — the customer presses one button and the stamps become a voucher. The balance is decremented by a *conditional* update (`stamps: { $gte: required }`), so a double tap cannot mint two vouchers from the same five stamps. `POST /api/customer/me/loyalty/reward`, behind `protectCustomer` + CSRF.
- `loyaltyService.validateVoucherForCustomer()` — a voucher is only ever spendable by the guest it was issued to. `validateVoucher` alone would let anyone who guessed or was handed a code spend another guest's reward.
- `orderService.createOrder({ voucherCode })` — the code resolves to money, becomes a discount on the shared engine, and is consumed against the order it discounted. Same soft-fail contract as coupons (a mistyped code costs the discount, not the order); staff callers get a hard failure via `couponStrict`.
- `sumBillableItems()` now subtracts `order.discountTotal`. It added up the line items and ignored them, so **every** discount — coupons included — was accepted at checkout and then charged in full at the counter.
- `findVoucher()` returns `null` when the code is not inside the card, turning a mistyped code into "Voucher not found" instead of a crash on `voucher.status`.

**UI.** A **Redeem reward** button on the loyalty card, live only when the card is full, opening a dialog that shows the code with a copy button and the date it expires. Unspent codes stay listed and click-to-copy on the profile. Where a code is spent — the table checkout and the till — it goes in a single field alongside coupons (see ISSUE-44).

**Guards:** `backend/__tests__/loyalty-voucher-redemption.test.js` (14 tests) — claim mints one voucher and spends the stamps, a short card is refused by name, an inactive programme refuses, a double tap cannot mint twice, a voucher is refused for the wrong customer / an unsigned-in guest / after expiry, the discount lands on the order, a foreign code leaves the order at full price with a notice, staff get a hard failure, a percentage voucher is applied as a percentage, and the bill total honours the discount without ever going negative — negative-tested.

---

### ISSUE-44 · P2 · Two code boxes where one was always meant
Both the table checkout and the till offered two fields — "Coupon code" and "Loyalty voucher code" — and neither did anything until the order was placed. A guest holding `RWD-9F2C11` had to guess which box it belonged to, and nobody learned what a code was worth until after the money was committed. The cashier had exactly the same two boxes at the till.

**Fix.** One field, one **Apply** button, and the code is *resolved* rather than declared (`promoService.resolvePromoCode`). The shape hints at where to look first (`RWD-` → the card shelf) and a miss falls through to the other shelf, so a mistyped prefix never tells a guest their own code does not exist. The answer names the offer — "Coupon applied — you save ₹50.00 on this order." — and that figure comes from the same helpers the order engine prices with, so the button and the bill agree. Both the table (`POST /api/orders/preview-code`, public, tenant taken from the table so a public endpoint is never told which café to look in) and the till (`POST /api/pos/preview-code`) call it.

**One code per bill.** `promoService.assertSingleCode()` refuses a coupon and a voucher together, enforced inside `orderService.createOrder` and `checkoutPosOrder` — the interface is not the only caller, so the rule cannot be bypassed by anyone posting both. At the till, a pasted code and a manual POS discount show as two lines summing to one total, so the cashier sees the figure the server will refuse rather than discovering it at checkout.

Editing the box clears the applied offer: a saving on screen must always describe the code in the box. An anonymous guest may still use a coupon; a reward voucher stays refused, because it belongs to a profile — which is also why the till needs the guest's number dialled *before* the code.

**Guard:** `backend/__tests__/promo-code-resolution.test.js` (13 tests) — a coupon names itself and quotes its saving, a voucher resolves against the guest's own card, a voucher never promises more than the bill is worth, a percentage voucher is applied as a percentage, each shelf falls through to the other, an empty box asks for a code, the *specific* refusal is reported instead of "not found" (wrong customer, expired), and both codes together are refused by the service and by the order engine — negative-tested.

---

### ISSUE-45 · P0 · A cashier could not open the orders board
`GET /api/orders` returned a bare **403 Forbidden** for the whole cashier role. Not a stale bundle and not a bad token: the route was gated `authorizeRoles('owner', 'manager')`, while the permission catalogue has always granted `order.view` and `order.status` to `cashier`, `waiter`, `barista` and `staff`. The two systems disagreed, and the route won — so every permission those roles were given on orders was unreachable, and a cashier who cannot see the orders cannot serve the table they are standing at.

**Fix.** The router is gated by `protect` + `tenantMiddleware` and each route by its **permission**: `order.view` for reads, `order.status` for status changes and adding items, `order.cancel` for cancelling, `table.manage` for moving an order to another table, `order.refund` for refunds. Roles still decide the *default* permission set, and a manager who strips `order.cancel` from one person now really removes it. Cancelling and refunding remain manager-and-owner work.

---

### ISSUE-46 · P1 · "Only for new customers" could not be expressed
`Coupon.appliesTo.customerIds` could name people, the admin UI could not enter them, and no rule existed — so the only way to target "new users" or "inactive users" was to pick profiles by hand and freeze the list at that instant. A win-back offer written on Monday would still exclude the customer who drifts inactive on Tuesday. The customer's own Offers card was worse: `getMyCoupons` filtered on `appliesTo.scope: 'customer'` (a value outside the model enum) and read four fields the model does not have (`label`, `discountType`, `discountValue`, `minOrderValue`, `usedCount`, `validUntil`), so a targeted offer was accepted at checkout and **never shown to the customer it was written for**.

**Fix — the audience is a rule, evaluated at redemption.**
- `segmentService.js`: a whitelist of readable fields (visits, lifetime and average spend, last/first visit, birthday, tags, email verification) with typed operators, five presets — new customers, inactive, loyal, birthday month, tagged — and `normalizeAudience()`, which drops any rule the engine would refuse rather than storing an audience that silently never matches. A segment with no rules falls back to everyone.
- `couponService.validate` evaluates the audience against the customer's **live** profile each time a code is used; the hand-picked list is answered from ids alone and costs no extra read.
- `promoService`, POS and the QR checkout are unchanged by design: a targeted code simply resolves like any other.

**Personal delivery.** `CouponGrant` gives each matched profile its own code (`WINBACK-A1B2C3`), delivered by a 15-minute sweep — audiences are a *state*, so "inactive for 30 days" has to be noticed while nobody is looking, not at sign-up. A grant code is typed into the same single field as any other, is refused for anybody but its owner, and is spent once. Café-wide auto-issue is deliberately refused: that is a newsletter, not a targeted offer.

**Admin.** The coupon form gains a rule builder generated from the engine's own whitelist (so the picker cannot offer a rule redemption would refuse), one-tap presets, and a **live "reaches N customers now"** count computed server-side — an audience matching nobody is worse than none, because the coupon still looks targeted. The coupons list shows who each offer is for; `GET /coupons/:id/grants` shows who was actually reached.

**Guards:** `backend/__tests__/coupon-audience.test.js` (21 tests) — normalisation drops unwhitelisted fields and bad operators, a segment with no rules becomes everyone, each preset matches exactly who it should (a lapsed regular stops matching the win-back offer the moment they return; a first-timer is "new", not "inactive"), a hand-picked list is answered without a profile read, an anonymous guest can use a café-wide offer but not a targeted one, the sweep issues only to the audience and never for a café-wide coupon, does not re-issue over a live code, fits the code field, and a grant resolves to its coupon, is refused for another customer and for a second use — negative-tested. `customer-rewards-surface.test.js` had its Offers assertions rewritten: they encoded the out-of-enum scope and the non-existent field names.

---

### ISSUE-47 · P0 · A returning guest could not order, and could have ordered into a settled bill
Customer visits, pays, and comes back to the same table. Scanning the QR opens straight into the app and the menu works, but pressing **Place order** answers *"A valid dining session is required to place an order."*

Two faults on the same line of code, and the second was the dangerous one.

**47a — a persisted session id was trusted without ever re-checking it.** `ensureSession()` opened with a fast path:

```js
if (activeSessionId && activeTableId === tableId) {
  return { sessionId: activeSessionId };   // believed, never verified
}
```

That id is written when the guest *starts* a visit. It is only cleared when the `session-paid` socket event lands — which never happens if the app was closed on the confirmation screen, the tab was backgrounded, or the network dropped for the moment the bill was settled. So the returning guest held last week's **closed** session, the fast path returned it, and checkout failed with a message about a missing session when the real problem was a dead one.

The two stores made it worse: the gate keeps its session in `useSessionStore`, the order is sent with `useCartStore.sessionId`, and `clearCart()` nulls only the second. After a payment that cleared the cart, those two values disagreed — the gate reported a session, checkout sent none. **The value that was verified is now the value that is sent**, and checkout keeps the session `ensureSession()` handed it instead of re-reading a store at submit time.

**47b — the server accepted orders into a closed session.** `createOrder` only blocked `bill_requested` and `awaiting_payment`. `closed`, `paid`, `abandoned` and `processing` sailed straight through, so a guest holding a stale session could add dishes to a bill that had already been settled: the kitchen saw them, no session carried them into any total, and nobody was ever charged. Only `active` accepts orders now, and the refusal is a **409** naming the fix — the client's correct response is to open a fresh session for that table.

**Self-healing.** The gate asks the server what is actually open on every entry (`GET /sessions/table/:id/active`, which only ever reports `active | bill_requested | awaiting_payment`) and drops the remembered id when nothing is open. Checkout additionally retries **once** against a newly opened session if the server still reports the old one as ended, so the guest taps *Place order* and it works.

**Guard:** `backend/__tests__/stale-session-order.test.js` (8 tests) — `closed`, `paid`, `abandoned`, `processing` and `left` are all refused with a 409 and nothing is written, `active` still works, and a table genuinely settling its bill still gets the *other* message rather than being told to start again — negative-tested.

---

### ISSUE-48 · P1 · A guest's own QR orders were missing from their order history
A guest orders from the table, eats, and later opens **Orders**. The list is empty — not "missing the last one", empty. Both of your customer's live rows sat outside it, and they are the two shapes a table order always takes before anyone pays:

| Order | channel | status | paymentStatus | shown? |
|---|---|---|---|---|
| ORD-…-0015 | `qr` | `served` | `unpaid` | no |
| ORD-…-0023 | `qr` | `pending` | `unpaid` | no |

**Cause.** ISSUE-33 fixed this list by making it *settled* — paid, or in the kitchen — which is a correct definition of **spend**. But it was the only list, so it also became the answer to "where is my order". A table order is written `pending` + `paymentStatus: 'unpaid'` and stays that way until someone settles the bill, so during the entire meal the guest's own order was invisible. `served` is the sharper half: the kitchen had finished it and the guest was eating it, and the order still was not in their history. Nothing had been lost — the orders were in the database and visible to staff the whole time — but from the customer's side their order looked like it had been swallowed.

**Fix — two lists, because those are two different questions.** Settled stays exactly as it was, so lifetime value, savings and the order counter on the profile keep counting real spend. In-progress orders come back under their own `active` key (`status` not settled **and** unpaid **and** not cancelled, capped at 20, fetched on page 1 only — they are few by nature, and an archived page should not refetch them). `OrderHistoryClient` renders them as a highlighted **In progress** section above the archive, each with a *Track order* link into the tracking page and the `channel` shown, so a table order is distinguishable from a till sale that look otherwise identical.

The empty state was the part that made this convincing rather than merely annoying — it now only claims "no orders yet" when there is genuinely nothing in *either* list.

**Verified:** 671 tests / 49 suites, `tsc --noEmit` clean, route audit PASSED, app boots clean.

**Guard:** `backend/__tests__/customer-order-history-settled.test.js` — extended from 6 to **14 tests**. A `pending`+`unpaid` QR order and a `served`+`unpaid` one both surface in `active` with `isLive`; a live order is **not** added to the settled list or to `total` (visibility must not inflate lifetime value); cancelled never appears in either list; a paid order leaves the live list for the settled one; `active` is empty on page 2; and the live query is tenant- and customer-scoped. The shared `Order.find` mock was also fixed — its `lean()` resolved a blanket `[]`, which would have made every payload assertion silently pass — negative-tested.

---

### ISSUE-49 · P1 · A cashier could not settle a table, and a guest at the counter had no way to get a bill
Two faults, both on the counter path.

**49a — `/bills` was role-locked, so the cashier could not open it at all.** Every billing route sat behind `authorizeRoles('owner', 'manager')`. Taking payment is the core counter job, so the role wall blocked exactly the person it was meant for: a cashier on the till could not see the board, could not confirm a payment, and could not settle a table through it. (They could still sell via POS — which is how the counter worked in practice, so this read as "the bills page is broken for me" rather than an outright outage.)

Billing is now permission-gated instead, and deliberately split three ways rather than opened wholesale:

| Permission | Cashier | Manager | Why |
|---|---|---|---|
| `bill.view` — open the board | ✅ | ✅ | It is a working surface, not a report |
| `bill.pay` — raise a bill, take payment, close | ✅ | ✅ | The counter job itself |
| `bill.adjust` — discount, comp, transfer ownership | ❌ | ✅ | The one bill action that quietly loses the cafe money |

Revenue reporting (`/sales-history`, `/settlement`, `/analytics`) stays on `report.view`, so opening `/bills` is not a side door into settlement totals. Verified live: cashier `GET /billing/bills` → **200**, `GET /billing/sales-history` → **403**, `POST /sessions/:id/adjustments` → **403**, bill total unchanged at ₹278 with 0 adjustments after the refused attempt.

**49b — no way to raise a bill for someone who walked up to the till.** A guest who asks for the bill at the counter never touched the app, so their session stayed `active` forever: the board showed **"Customer is still ordering..."** with no action, and `Confirm Payment` was unreachable. The table could only be closed by writing the bill off. `POST /sessions/:id/request-bill` now moves such a session to `awaiting_payment` — the same state the guest's own button produces — so everything downstream (Confirm Payment, the pipeline, the invoice) applies unchanged. It is **idempotent** (a double-tap is success, not an error), refuses a ₹0 table, and refuses `paid`/`closed` so a settled table cannot be double-charged. The card now shows a **Raise Bill** button where the dead-end text used to be.

**On "must the order be served first?" — no, and deliberately so.** Verified live rather than assumed: a `pending`, unserved order is fully priced into `bill-preview` (₹139, 1 order, item shown) and `submit-payment` accepts it. A guest is entitled to pay and leave; refusing would only trap them at the table. No served-gate was added, in either direction.

**Also fixed while verifying — a crash found in the path.** `createSession` built the session with `customerEmail: (customerEmail || '')` but the participant record with `customerEmail.trim()`. Email is optional since Module #09 (phone OTP, attach email later), so **any guest who skipped the email field got a 500 and no table at all**. Every existing test supplied an email, which is exactly why it went unnoticed.

**Verified live** against the running backend, end to end: guest scans → orders → cashier raises bill (`active` → `awaiting_payment`) → repeat tap is idempotent → table appears on the board at ₹278 → cashier's discount attempt refused with the total intact.

**Guard:** `backend/__tests__/counter-bill-raise.test.js` (14 tests) — cashier holds view+pay but **not** adjust; a waiter and barista get neither; the revenue reports stay closed to a cashier; a per-user override still promotes one cashier if the cafe wants to; raising a bill is **not** gated on the food being served; a double-tap writes nothing; `paid`/`closed`, an empty table and a cross-café id are each refused; the guest is notified and the ledger records that the counter raised it. Mutation-tested (handing the cashier `bill.adjust` fails the guard). Plus one test added to `session.test.js` for the no-email crash — mutation-tested by reverting the fix.

**Counts:** 694 tests / 50 suites, `tsc --noEmit` clean, route audit PASSED (202 frontend calls, 0 unresolved), app boots clean.

---

### ISSUE-05 · P2 · Internal error details leaked to clients
`errorHandler` returned the raw `err.message` for any 500 — which is how you saw `Cannot read properties of undefined (reading 'googleReviewUrl')` with a full stack trace and absolute server file paths.

**Fix:** 5xx responses are now logged server-side and returned as a generic message in production. 4xx messages pass through unchanged (they are safe and useful). Verified: a production-mode 500 no longer contains the internal path.

---

### ISSUE-06 · P2 · No fail-fast on bad configuration
The backend booted happily with no `JWT_SECRET`, or with a short/placeholder one, and only failed later deep inside `jsonwebtoken`.

**Fix:** `backend/src/config/env.js` validates on load and **exits non-zero** in production when `MONGODB_URI`/`JWT_SECRET` are missing, the secret is under 32 chars or looks like a placeholder, `FRONTEND_URL` still points at localhost, or `FRONTEND_PUBLIC_URL` is not https. Verified by forcing a bad production config.

---

### ISSUE-07 · P2 · No health endpoint, no proxy trust
No `/api/health` for load balancers or uptime monitors, and no `trust proxy`, meaning behind nginx/Render/Fly every client would share one rate-limit bucket and one audit-log identity.

**Fix:** added `GET /api/health` (200 healthy / 503 degraded, no auth) and `app.set('trust proxy', 1)`. Verified live: `{"status":"ok","database":"connected"}`.

---

### ISSUE-09 · P0 · ⚠ DEVELOPMENT DATABASE IS CURRENTLY EMPTY
**Status:** Detected during the session-host verification. **Action required from you.**

The Atlas database `qrdine.4uxomti.mongodb.net` / db `test` contains **0 users, 0 tables, 0 orders, 0 menu items**. Earlier in this same session it held 2 cafés, 3 users and 4 tables.

**What I ruled out (with evidence):**
- The Jest suite **cannot** reach it. I replaced `MONGODB_URI` with a poisoned `mongodb://127.0.0.1:1/POISONED` value and ran all 380 tests — **all 380 still passed**, proving no test connects to the real database.
- The only `dropDatabase()` / `deleteMany({})` calls in the repo are in `__tests__/integration/setup.js`, and those connect only to `mongodb-memory-server` (verified working).
- `scripts/migrate-tables.js` is read-only apart from adding `publicId`/`guestUrl`.

**So the loss did not come from the test suite or any script in this repo.** It came from outside — most likely an Atlas-side reset/pause of the free-tier cluster, or something run outside this session. I cannot determine the exact cause from inside the codebase.

**Recovery:** no automated restore exists (there is no seed script and no backup — this is BLOCKER-06 in concrete form). You must re-seed manually:
1. `POST /api/auth/register-owner` to recreate the café + owner.
2. Re-create categories, menu items and tables through the admin UI (table QRs regenerate themselves via `ensureTableIdentity`).

**Hardening applied:** `__tests__/integration/setup.js` now calls `assertDisposableHost()` before any `dropDatabase()` / `deleteMany({})` and **throws** unless the connection host is `localhost`/`127.0.0.1`. Even if a future refactor wires the real URI into the test harness, the destructive call now fails loudly instead of silently wiping production.

---

### ISSUE-08 · P2 · A test silently depended on your `.env`
`reviews.test.js` asserted the AI-degradation path by relying on `GOOGLE_API_KEY` being **absent**. The moment you added a real key (which you did), it made a live network call and failed with `request_failed`. A test that changes meaning based on a developer's local environment is a latent production defect.

**Fix:** mocked `geminiService` so it passes deterministically with or without a key.

---

## 3. Verification performed

| Check | Result |
|---|---|
| Backend boot | `BACKEND BOOT OK` |
| Test suite | **452 passed / 26 suites**, 0 failing |
| `tsc --noEmit` | clean |
| `next build` | clean |
| Route audit (`backend/scripts/route-audit.js`) | 163 frontend calls, **0 unresolved**; all protected writes CSRF-guarded |
| Live: `GET /api/health` | `200 {"status":"ok","database":"connected"}` |
| Live: `GET /api/reviews/settings` (legacy café) | `200`, defaults supplied |
| Live: `GET /api/tables/:id/qr` | `qrDataUrl` present, 4770 chars, valid PNG data URL |
| Live: CSRF no-token / header-only / mismatch | all correctly `403` |
| Live: CSRF matching pair | `200`, table created |

A new static checker, `backend/scripts/route-audit.js`, now cross-checks every frontend API call against the Express route table and asserts CSRF coverage — so a typo or an unguarded mutation fails loudly in CI instead of in a browser console.

---

## 4. What is *not* wrong (checked and cleared)

Worth stating explicitly, because these are the things that would actually block a subscription sale:

- **Tenant isolation** — every collection leads with `cafeId`, every query filters by `req.cafeId` from the verified JWT. No cross-tenant leak found.
- **Price integrity** — the backend re-resolves menu item prices server-side; client-supplied prices are ignored.
- **AuthN/AuthZ** — JWT verification, role+permission checks, and PIN lockout all behave correctly. The 403s you saw were the system working.
- **Secrets hygiene** — `.env` files are gitignored; the Gemini key is server-side only and lazily loaded.
- **Rate limiting** — present on auth, PIN, and review submission.

---

## 5. Open gaps blocking a subscription launch

These are **not** bugs — they are commercial/operational decisions and infrastructure work that must happen before you can sell this. I have not implemented them, because each needs your input or a vendor account.

### BLOCKER-01 · No payment gateway
Cash and manual UPI/card only. There is **no online payment capture**, so you cannot take money through the product itself. Revenue depends entirely on the customer settling at the counter.
**Needs:** gateway choice (Razorpay is the obvious fit for India), API keys, webhook handling, refund reconciliation.

### BLOCKER-02 · No subscription/billing system for the merchant

> **Partially resolved 2026-10-05.** The plan catalogue, the trial, the full expiry lifecycle and the operator control plane now exist and are tested (80 new tests; `npm test` 792/56 green). Full design in `docs/SUBSCRIPTION_BILLING.md`.
>
> - **Pricing** lives in `backend/src/config/plans.js` — one table, integer paise, GST on top. Trial ₹0/14d; Starter ₹349; Growth ₹499; Pro ₹649 (annual = 10× monthly); extra outlets charged per outlet on every plan.
> - **Lifecycle** is `trialing → active → grace (7d) → degraded → terminated`, derived at read time by `computeAccess(row, now)` rather than stored, so it is correct for tenants that expired while the process was down and needs no sweeper.
> - **Degrading never stops the counter.** Ordering/POS/KDS stay available at every state short of termination; only paid modules lock. Guest ordering is deliberately never gated.
> - **Super-admin control plane** at `/api/superadmin` — search tenants, MRR overview, grant plan, extend trial, terminate/reinstate, renewal-chase list. Termination is `superadmin`-role only and requires a stated reason.
>
> **Still missing, and it is the part that matters commercially:** no payment gateway is integrated. `POST /api/subscription/checkout` returns `503 PAYMENT_GATEWAY_NOT_CONFIGURED` with the quote attached — deliberately, because a stub that pretends to charge would leave a café believing it had paid with no record of the money. Until a gateway plus a signature-verified webhook lands, **no plan can actually be bought**. Also outstanding: renewal webhooks and dunning email, `requireFeature` not yet applied to the individual loyalty/coupon/analytics/NFC/review routers, no super-admin UI, and no backfill script for cafés created before this change (they are migrated lazily on first access instead).
>
> **Needs:** a payment gateway + webhook (this is the last true blocker), then the dunning loop.

### BLOCKER-03 · No email delivery configured
SMTP vars are wired but unset. Review alerts, low-rating manager alerts, and shift/receipt emails will silently not send.
**Needs:** provider account + credentials.

### BLOCKER-04 · No error tracking or structured logging

> **Resolved 2026-10-05 (provisioning not done).** Structured JSON logging, per-request correlation ids and optional Sentry integration are implemented and tested (21 tests in `backend/__tests__/observability.test.js`).
>
> - `services/logger.js` — zero-dependency, one JSON object per line in production, with `LOG_LEVEL`. **Redacts PII recursively** (phone numbers, e-mails, passwords, OTPs, cookies, guest tokens) because these lines go to a third party.
> - `services/errorTracking.js` — Sentry wrapper that is **optional and fail-soft**: the SDK is loaded lazily, so no account means no dependency and no impact on boot. `scrubEvent` scrubs headers, cookies, bodies and breadcrumbs on the way *out* — belt-and-braces with the logger, because Sentry's own middleware captures request data that never passed through our logger.
> - `middlewares/requestContext.js` — every response carries `x-request-id`, so a customer-reported failure is traceable via `grep`.
> - `env.js` warns loudly at boot in production when `SENTRY_DSN` is unset.
>
> **Still needed:** create the Sentry project and set `SENTRY_DSN` (an environment value, not a code change), plus uptime alerting on `/api/health` — nothing pings you when the service is down.

### BLOCKER-05 · No deployment configuration

> **Substantially resolved 2026-10-05; the image itself is unverified.**
>
> - `backend/Dockerfile` — multi-stage, `npm ci --omit=dev`, runs as non-root `node`, `dumb-init` as PID 1 so SIGTERM actually reaches Node, and a healthcheck against the real `/api/health`. `.dockerignore` keeps `.env`, backups and uploads out of the build context.
> - `backend/src/server.js` — **graceful shutdown added**. Every orchestrator stops a container with SIGTERM; previously Node exited instantly, cutting in-flight order writes and dropping live KDS sockets. It now drains sockets, closes the server, closes Mongo, and force-exits after 15s.
> - `backend/.env.example` — the environment contract, annotated. The production validator in `config/env.js` is test-covered, so the docs and the validator cannot drift apart silently.
> - `.github/workflows/ci.yml` — backend suite, frontend typecheck + build, route contract, and an image build that **fails if `.env` is ever baked in**.
> - `docs/PRODUCTION_DEPLOY.md` — runbook, including the nginx WebSocket-upgrade config (the most common way a deploy looks healthy but real-time updates are broken).
>
> **Unverified:** the Docker image has never actually been built — Docker is installed on this machine but its engine was not running. The CI `docker` job will be the first real build. The Dockerfile's healthcheck command *was* tested directly against a live server (exit 0 healthy / exit 1 dead).
>
> **Known CI gap:** frontend `lint` runs non-blocking. It has ~370 outstanding problems including ~24 genuine React Hooks errors; gating CI on that today yields a permanently red build. Flip to blocking once cleared.

### BLOCKER-06 · No automated backup or data retention policy

> **Partially corrected 2026-10-04.** The original text claimed `MONGODB_URI` points at a local instance. **It does not** — it already points at a managed Atlas cluster (`mongodb+srv://…@qrdine.4uxomti.mongodb.net`). The managed-cluster requirement is met.
>
> The real exposure was quieter: the URI carries **no database name**, so Mongoose connects to a database literally called `test` — no error, no warning, and `GET /api/health` reports healthy. Orders land in an empty database. That is now enforced: `collectDatabaseProblems()` in `backend/src/config/env.js` refuses to boot production on a missing/`test` database name, a local URI, an undeclared replica set (owner registration runs in a transaction, which a standalone `mongod` rejects at runtime), `retryWrites=false`, or a missing `w=majority`. Covered by `backend/__tests__/production-database-config.test.js` (12 tests) and verified against a real production boot.
>
> What genuinely remains: Atlas **M0 has no continuous backup or point-in-time restore** — it is replicated but not protected against logical corruption or a bad deploy. M10+ (~$70/mo) is required for that. `backend/scripts/backup.js` now provides an independent application-level backup with SHA-256 verification and a restore drill, exercised end-to-end by `backend/scripts/backup-drill.test.js`. Retention and PII policy are in `docs/BACKUP_AND_RETENTION.md`.

**Needs:** Atlas M10+ (or a documented acceptance of the risk), a daily schedule for `scripts/backup.js`, one rehearsed restore, and legal sign-off on the retention policy.

### Deferred by decision — super admin panel

> **Backend done 2026-10-05; UI still outstanding.** The control plane exists as an API: `SuperAdmin` model (separate collection from `User`, so tenant middleware can never address it), `protectSuperAdmin` requiring a `typ: 'superadmin'` claim, role separation (`support` can grant plans, only `superadmin` can terminate), and `scripts/create-superadmin.js` to create the first operator. Both privilege-crossing directions are covered by tests.
>
> **Needs:** the actual operator-facing pages. `/api/superadmin` is API-only and no admin frontend consumes it yet.

### Lower-severity, worth fixing before launch
- **No `.xlsx` export** — CSV only. Indian accounting workflows generally expect Excel.
- **No SMS** — the `notificationService` channel seam exists and is ready, but needs a provider account and DLT registration.
- **Reusable modifier groups** — currently embedded per menu item; awkward for a large menu.
- **No IP geolocation** — a second geofence signal; needs a paid provider.
- **NFC provisioning** requires Android Chrome or an NDEF writer app; the QR fallback covers other phones, but this is a support-cost item.
- **Accessibility / i18n** — no audit has been done. GST invoices in India require certain fields and formatting; worth confirming compliance explicitly.
- **Stray `nul` file** in the repo root (pre-existing, from a Windows `> nul` redirect) — delete it.

---

## 6. Suggested order of work

1. **BLOCKER-02** first — without subscription billing there is nothing to sell, regardless of how good the product is.
2. **BLOCKER-01 + BLOCKER-03** — take money, and notify the merchant when something needs attention.
3. **BLOCKER-04 + BLOCKER-05** — you cannot operate a paid service you cannot observe or reliably deploy.
4. **BLOCKER-06** — before the first real customer's data exists.
5. The lower-severity list, as customer demand justifies.

---

## 7. Regression guards added

- `backend/__tests__/table-qr-csrf.test.js` — 10 tests (QR payload shape + CSRF double-submit contract)
- `backend/__tests__/production-hardening.test.js` — 8 tests (legacy-café settings, error leakage, config validation)
- `backend/scripts/route-audit.js` — static frontend↔backend route + CSRF coverage checker. Its CSRF check was rewritten to be per-route (balanced-paren statement capture) instead of an 8-line positional window, which both fixed false positives and now catches multi-line registrations. Verified with a deliberate unguarded route as a negative control — the checker fails on it.
- `backend/__tests__/subscription-lifecycle.test.js` — 31 tests (pricing maths, GST, annual discount, date clamping, the expiry ladder, fail-closed behaviour)
- `backend/__tests__/subscription-service.test.js` — 16 tests (trial creation, unique-index race safety, terminate/reinstate, expiry sweep) against a real in-memory MongoDB
- `backend/__tests__/super-admin-auth.test.js` — 19 tests (café token rejected by the control plane and vice versa, deactivation, lockout, role restrictions)
- `backend/__tests__/super-admin-api.test.js` — 14 tests (login, MRR overview, tenant search, CSRF enforcement, terminate/reinstate end to end over HTTP)
- `__tests__/setup.js` — `mockRes()` gained `locals` (Express exposes it; the mock did not)
- `backend/__tests__/coupon-scope.test.js` — 8 tests (every `appliesTo.scope` path, eligible-subtotal capping, min-order vs basket)
- `backend/__tests__/coupon-qr-soft-fail.test.js` — 4 tests (guest coupon soft-fail vs POS strict-fail; no redemption on rejection)
- `backend/__tests__/customer-auth.test.js` — 21 tests (OTP hashing, attempt limits, cross-café isolation, targeted coupons, `OTP_FIXED_CODE` production guard)
- `backend/__tests__/customer-preferences.test.js` — 8 tests (veg-only and notification toggles, coercion, pre-field profile repair, language refusal)
- `backend/__tests__/customer-signin-persistence.test.js` — 10 tests (guest CSRF matcher coverage, name persisted so checkout stops re-prompting, `needsOtp` gating, CSRF enforcement retained) — negative-tested
- `backend/__tests__/max-width-token-collision.test.js` — 5 tests (no bare `max-w-<spacing-token>` anywhere in `frontend/src`; both POS dialogs pinned) — negative-tested
- `backend/__tests__/pos-payment-amounts.test.js` — 8 tests (overpayment refused with nothing persisted, split payments summing exactly accepted, per-tender-valid overshoot refused, paisa-precision float tolerance)
- `backend/__tests__/pos-checkout-atomic.test.js` — 8 tests (nothing written on a bad tender list, counter sale born `served` not `pending`, phone links the CRM profile, idempotent replay does not settle twice, dine-in vs takeaway table rules, wallet tender refused with no debit) — negative-tested
- `backend/__tests__/session-lifecycle-close.test.js` — 10 tests (idle sweep closes empty tables only, never `bill_requested`/`awaiting_payment`, honours the 10-min window; manual close records totals, refuses to strand unpaid orders, write-off leaves a ledger trail, tenant-scoped) — negative-tested
- `backend/__tests__/customer-order-history-settled.test.js` — 14 tests (`SETTLED_STATUSES` contains only real model statuses, a paid-but-`pending` order matches, cancelled never does, profile counters share one definition; **ISSUE-48**: an unpaid QR order is visible as `active` and is still excluded from spend totals, a paid order migrates out of the live list, the live query is tenant-scoped and skipped past page 1) — negative-tested both halves; the `lean()` mock fixed so payload assertions are not blind
- `backend/__tests__/order-client-request-id.test.js` — 4 tests (`clientRequestId` omitted rather than `null`, so the sparse unique index is honoured; POS born `served`, QR defaults `pending`) — negative-tested
- `backend/__tests__/billing.test.js` — added a guard that both revenue aggregations receive a real `ObjectId`, since `aggregate()` casts nothing and an uncast tenant id reads as ₹0 with rows on screen — negative-tested; also **rewrote** the `served`-items-only test that had encoded ISSUE-39b's bug
- `backend/__tests__/customer-phone-canonical.test.js` — 14 tests (one canonical phone form across OTP sign-in, POS and till lookup; legacy rows healed; canonical preferred over a silent merge) — negative-tested
- `backend/__tests__/invoice-resend-recipient.test.js` — 8 tests (409 rather than a false success when nobody can be emailed, verified profile email accepted, unverified refused, supplied address persisted, SMTP failure reported honestly) — negative-tested
- `backend/__tests__/customer-rewards-surface.test.js` — 9 tests (tenant from the profile not the request, inactive programme distinguished from zero stamps, unrevealed card withholds its prize, only this customer's coupons, expired dropped) — negative-tested
- `backend/__tests__/guest-bill-request-identity.test.js` — 11 tests (host may request the bill, member refused, missing identity refused, hostless session promoted; bill never zero while food is ordered, withdrawn items excluded, line GST added once) — negative-tested
- `backend/__tests__/payment-pipeline-settlement.test.js` — 5 tests (settlement prices a pending kitchen line, the settled visit awards its loyalty stamp, `orderService` is imported, a mid-pipeline failure releases the `processing` lock to the displaced status) — negative-tested
- `backend/__tests__/session-processing-recovery.test.js` — 8 tests (boot sweep reopens sessions orphaned in `processing`, restores the displaced status, honours the 2-minute grace window, leaves a session that settled mid-sweep alone) — negative-tested
- `backend/__tests__/bills-loyalty-surface.test.js` — 6 tests (stamp progress on every bills row, only redeemable vouchers listed, tenant-scoped batch lookup, session detail returns orders + totals + loyalty together, cross-café session 404) — negative-tested
- `backend/__tests__/loyalty-voucher-redemption.test.js` — 14 tests (claiming a full card mints exactly one voucher and spends the stamps, a short card is refused by name, a voucher cannot be spent by another guest or an anonymous one, an expired code is refused, the discount reaches the order and the bill total, staff get a hard failure where guests get a notice) — negative-tested
- `backend/__tests__/promo-code-resolution.test.js` — 13 tests (one typed code resolves as either a coupon or a reward voucher, each shelf falls through to the other, the specific refusal beats a generic “not found”, a voucher cannot exceed the bill, a coupon and a voucher cannot both reach one order) — negative-tested
- `backend/__tests__/coupon-audience.test.js` — 21 tests (audience normalisation refuses unwhitelisted rules, each preset matches exactly its audience and stops matching when the customer drifts out of it, an anonymous guest cannot use a targeted offer, the grant sweep issues only to the audience, a personal code is refused for another customer and for a second use) — negative-tested
- `backend/__tests__/stale-session-order.test.js` — 8 tests (an order into `closed`, `paid`, `abandoned`, `processing` or `left` session is refused with a 409 and writes nothing, `active` still works, a table settling its bill keeps its own message) — negative-tested
- `backend/__tests__/counter-bill-raise.test.js` — 14 tests (ISSUE-49: cashier holds `bill.view`+`bill.pay` but **not** `bill.adjust`, a waiter/barista get neither, the revenue reports stay closed to a cashier, a per-user override still promotes one cashier, raising a bill is **not** gated on the food being served, a double-tap writes nothing, `paid`/`closed`/₹0/cross-café are each refused, the guest is notified and the ledger records the counter raised it) — mutation-tested
- `backend/__tests__/session.test.js` — added a guard that a guest may open a table **without** an email (the participant record crashed on `customerEmail.trim()` while the session record guarded it) — mutation-tested by reverting the fix
- `backend/scripts/repair-customer-phones.js` — merges customer profiles split by inconsistent phone normalisation; `--dry` supported, refuses to merge when both sides have live orders
- `backend/scripts/verify-persisted-store-hydration.js` — asserts the server-rendered persisted-store components keep their hydration gate, and that no file reads `store.persist` directly (self-tested and negative-tested)