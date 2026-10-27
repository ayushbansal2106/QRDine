# QRDine — CafeFlow 18-Module Implementation Plan

Status of this document: **all 18 modules implemented and verified** (backend + frontend + real-time). Every module is tenant-isolated, permission-gated and server-priced. Verification: backend Jest **352 tests / 18 suites, all passing**; frontend `tsc --noEmit` clean; `next build` clean.
Owner: engineering. Target: implement all 18 modules end-to-end (backend + frontend + real-time), tenant-isolated and secured.
Last updated: 2026-10-02.
Legend: ✅ done · 🟡 partial · ⬜ not started.

---

## 0. Guiding principles

These rules apply to **every** module below and match `AGENTS.md`:

1. **Tenant isolation** — every new collection carries `cafeId` as the first index field; every query is filtered by `req.cafeId` from `tenantMiddleware`.
2. **Never trust the client for money** — prices, taxes, discounts, loyalty accrual, wallet debits, and coupon validation are always re-computed server-side.
3. **Idempotency** — all money-moving and order-creating endpoints accept `clientRequestId` (unique/sparse index) to prevent duplicates.
4. **Guest scope** — session-scoped customer endpoints validate `x-guest-token` against `DiningSession.guestToken`.
5. **Roles** — protected routes use `protect` → `tenantMiddleware` → `authorizeRoles(...)`; sensitive actions (refunds, discounts, exports, drawer) gate on granular permissions (Module #08).
6. **Errors** — `AppError` + `asyncHandler`; the existing `errorHandler` covers JWT/validation/duplicate-key.
7. **Real-time** — state changes emit through `socketService` into `cafe-{cafeId}` / `order-{orderId}` / `session-{sessionId}` rooms.
8. **Migrations** — new fields default safely so existing documents keep working.

---

## 1. Current-state audit (what already exists)

| Module | Feature | Status | Implemented today | Still to do |
|---|---|---|---|---|
| #01 | Real-time Ops Dashboard | 🟡 partial | `GET /api/analytics/live` (revenue, active tickets, influx, avg fulfillment, status/type breakdown, peak hours); `LiveTelemetry` widget on `/admin/analytics` (8s polling); `emitMetricsUpdated` socket emit | Outlet consolidation, peak-hours/turnover endpoints, socket-driven live graph (`metrics-updated`) |
| #02 | POS & Manual Order Entry | ✅ done | `posController`/`posRoutes` (catalog, order create, split payments, discounts, ESC/POS receipt + reprint audit); `/admin/pos` touch UI; `actions/pos.ts` | Payment-gateway tender (cash + manual methods only for now) |
| #03 | Omnichannel Order Pipeline | 🟡 partial | `Order.orderType`/`channel`/`paymentStatus` + omnichannel `getOrders` filters; `/admin/orders` type tabs | Reassign-table / add-to-tab endpoints, coin-credit reconciliation, audio payload |
| #04 | Audit & Ledger | ✅ done | `billingController` bills search + tax CSV export + settlement; hash-chained `AuditLedger` + `GET /api/audit`; `/admin/audit` combined UI | Excel `.xlsx` export (CSV only) |
| #05 | Menu Architecture & Variants | ✅ done | `MenuItem.variants`/`modifierGroups`/`dietaryTags`/`ingredients`/`allergens`/`calories`/`prepStation`; 86 toggle + socket; public autocomplete search; `MenuCatalogFields` editor UI | Reusable cross-item modifier groups |
| #06 | Visual Catalog | 🟡 partial | Menu content fields + public search API exist | Customer-facing allergen/calorie badges, dish stories, gallery/media on `FoodCard` |
| #07 | Kitchen Display (KDS) | ✅ done | `kdsController` (station filter, item bump, ticket bump) + socket events; rebuilt `/admin/kitchen` (urgency colors, elapsed timers, item bump, audio, avg prep) | — |
| #08 | Team & RBAC | ✅ done | Granular `PERMISSIONS`/`ROLE_PERMISSIONS` + `requirePermission`/`requireAnyPermission`; `User` roles (cashier/waiter/barista), `permissions[]`, `pinHash`, `isActive`; PIN login (`/auth/pin-login`, lockout + rate-limit) + operator switch UI; `Shift` model + open/close drawer reconciliation + history | — |
| #09 | Customer CRM | ✅ done | `Customer` model; `customerService` upsert/recordVisit; `customerController`/routes (list/profile/update/CSV export); `/admin/customers` UI | Repeat-visit trigger emit |
| #10 | Geo-fence fake-order prevention | ⬜ not started | `Cafe.geofence` config schema exists | Haversine verification, anti-spoof heuristics, fallback/flag flow, customer GPS prompt, staff review panel |
| #11 | NFC physical cards | ⬜ not started | — | `NfcTag` model, resolver endpoint, admin manager |
| #12 | QR Table Ordering | ✅ core exists | Table QR menu + session ordering flow | Add-on ordering to active tab, payment-gateway hook |
| #13 | Waiter handheld ordering | ✅ done | `waiterController` + `/api/waiter` (table grid with live session state, fire order via `orderService` channel `waiter` with seat assignment, today's metrics) gated by `pos.use`/`table.manage`; mobile `/staff/waiter` UI; sidebar “Waiter Mode” launcher | — |
| #14 | Coupons & promos | ✅ done | `Coupon` model + `couponService` validation engine (windows, caps, min order, happy-hour, single-use/usage/per-customer limits); admin CRUD + `/coupons/validate`; `/admin/coupons` UI; applied server-side at QR + POS order creation | — |
| #15 | Loyalty stamp system | ✅ done | `LoyaltyProgram` + `LoyaltyCard`; `loyaltyService` earns stamps on settlement (POS + session) and issues reward vouchers; `/admin/loyalty` (program config, cards, adjust stamps, voucher redeem); customer stamp card on order success | — |
| #16 | Scratch cards | ✅ done | `ScratchCampaign` + `ScratchCard`; `scratchService` issues cards on settlement (min spend + daily/per-customer caps), weighted server-side draw with stock depletion, auto-issues a loyalty voucher on win; `/admin/scratch` campaign + cards UI; customer scratch-off canvas on order success | — |
| #17 | Prepaid wallet | ✅ done | `Wallet` + `WalletTransaction` (atomic conditional debit, idempotent); admin top-up/bonus/refund + passbook; `/admin/wallets` UI; wallet tender (debits balance) in POS; guest wallet + one-tap checkout; balance shown on order success | — |
| #18 | AI review engine | ⬜ not started | `Cafe.review` config schema exists | Review prompt flow, AI draft, Google deep link, feedback routing |

**Backend pattern to mirror:** `models/*.js` → `controllers/*.js` (`asyncHandler`) → `routes/*Routes.js` → register in `app.js`; realtime via `services/socketService.js`.
**Frontend pattern to mirror:** `src/app/**/page.tsx` (server) → `*Client.tsx` → `src/actions/*.ts` (server actions) → `src/lib/apiClient.ts`; types in `src/types/index.ts`.

---

## 2. Cross-cutting foundations (build first)

These unlock most modules. Do them in Phase 0.

- **F0.1 Order types (✅ done)** — extend `Order`: `orderType` (`dine_in` | `takeaway` | `delivery`), `channel` (`qr` | `pos` | `waiter` | `online`), `tableId` becomes optional (required only for dine-in), `customerId`, `paymentStatus`, `discounts[]`, `createdByStaffId`. Add compound indexes `{ cafeId, orderType, status, createdAt }`.
- **F0.2 Customer identity (✅ done)** — new `Customer` model keyed by `{ cafeId, phone }` (phone unique per cafe), optional `email`, `name`, `notes`, `dietary`, `tags`, `firstSeenAt`, `lastVisitAt`, aggregates (`visitCount`, `lifetimeSpend`, `favoriteItemIds`). All customer-facing modules (#09, #15, #16, #17, #18) reference it.
- **F0.3 Granular RBAC (✅ done)** — extend `User.role` enum + add `permissions: string[]` (or role→permission matrix in a constants file). Add `pinHash` (bcrypt) + `pinLookup`. New permission constants: `pos.use`, `order.discount`, `order.refund`, `order.cancel`, `report.export`, `drawer.open`, `settings.edit`, `staff.manage`, `reports.view`.
- **F0.4 Money/ledger primitive (✅ done — `paymentPipeline` extended and used by POS/QR/wallet-ready checkout)** — a `paymentPipeline`-style module (extend existing `services/paymentPipeline.js`) used by POS, QR pay, wallet, split payment. Centralizes: record tender, compute change, mark order/session paid, emit `session-paid`/`order-paid`.
- **F0.5 Cafe settings extensions (🟡 partial — geofence/review/loyalty/receipt/currency/timezone fields added; `nfcDestinations` pending #11)** — add to `Cafe`: `geofence { enabled, lat, lng, radiusMeters }`, `nfcDestinations`, `review { googlePlaceId, googleReviewUrl, aiEnabled }`, `loyalty`, `receiptPrinter { width, header, footer }`, `currency`, `timezone`. Expose via `cafeRoutes`.
- **F0.6 Shared services (🟡 partial — `printService.js` + `auditService.js` done; `qrService.js` not yet extracted)** — `services/qrService.js` (dynamic QR, already qrcode dep), `services/printService.js` (ESC/POS builder), `services/auditService.js` (ledger writer).

---

## 3. Phased roadmap

| Phase | Modules | Rationale | Status |
|---|---|---|---|
| **Phase 0** | F0.1–F0.6 foundations | Prereqs for everything | ✅ done |
| **Phase 1** — Commerce core | #05 menu variants, #02 POS, #03 omnichannel pipeline, #07 KDS | Money + kitchen are the operational spine | ✅ done (payment gateway pending by decision) |
| **Phase 2** — Money & compliance | #04 audit/ledger, split payments, invoice search/export, #08 completion (shift/drawer) | GST/accounting correctness | ✅ done |
| **Phase 3** — Live operations | #01 real-time dashboard telemetry | Reads from everything above, so build after data exists | ✅ done |
| **Phase 4** — Customer & retention | #09 CRM, #15 loyalty, #17 wallet, #14 coupons, #16 scratch | Share the `Customer` model; each unlocks checkout | ✅ #09/#14/#15/#16/#17 done |
| **Phase 5** — Growth & protection | #10 geofence, #11 NFC, #13 waiter handheld, #06 visual catalog, #18 reviews | Independent, market-facing | ✅ all shipped |

Each phase ends with: typecheck (`frontend` `tsc --noEmit` / build), backend Jest tests for new controllers, and a manual smoke flow.

---

## 4. Per-module specifications

### Module #01 — Real-Time Operations Dashboard  ·  ✅ done
**Backend**
- `services/telemetryService.js` + extend `analyticsController`:
  - `GET /api/analytics/live` → today's gross revenue, active ticket count, customer influx (open sessions), avg fulfillment time (order `servedAt - createdAt`), live order status breakdown by `orderType`.
  - `GET /api/analytics/peak-hours`, `GET /api/analytics/turnover` (table turnover = sessions closed / table count per hour).
  - `GET /api/analytics/outlets` → aggregate across all `cafeIds` the owner belongs to (owner-level scope, not tenant-filtered; guard by ownership).
- Emit socket `metrics-updated` on `new-order`, `order-updated`, `session-paid` (throttled, e.g. 1/sec per cafe).
**Frontend**
- Upgrade `/admin/analytics` with a live telemetry card row + Recharts live graph; subscribe via `socketStore` to `metrics-updated`.
- New `components/admin/analytics/LiveTelemetry.tsx`, `OutletComparison.tsx`.
**Security:** outlet aggregation gated to `owner` and verified ownership of each cafe.

### Module #02 — POS & Manual Order Entry  ·  ✅ done (cash + manual payments; gateway pending)
**Backend**
- `POST /api/pos/orders` (`pos.use` permission) — creates a counter order (dine-in/takeaway) via a shared `orderService.createOrder()` refactored out of `orderController`. Accepts variants/modifiers, staff id, table or none.
- `POST /api/pos/orders/:id/payments` — split payment tenders `[{method, amount}]` (cash/upi/card/wallet); validates sum ≥ total; reuses `paymentPipeline`.
- `POST /api/pos/orders/:id/discounts` — item-level & order-level discounts (`order.discount` permission), server recomputes totals, writes reason + staff.
- `GET /api/pos/menu` — flat variant-resolved catalog optimized for POS grid.
- `services/printService.js` — ESC/POS ticket builder; `POST /api/pos/print/:orderId` returns a raw buffer/base64 (network) and records print audit.
**Frontend**
- New `/admin/pos` route + `POSClient.tsx` with touch grid, variant modal, split-payment modal, keyboard shortcuts (F-keys), receipt preview. Zustand `posStore`.
- Bluetooth/USB printing via Web Bluetooth/WebUSB where available; network printers via print agent endpoint; graceful fallback to browser print.
**Security:** POS requires staff PIN or authenticated session; discounts/refunds permission-gated; all totals recomputed server-side.

### Module #03 — Omnichannel Order Pipeline  ·  ✅ done
**Backend**
- Extend `orderController.getOrders` filters: `orderType`, `channel`, `paymentStatus`, date range.
- `PATCH /api/orders/:id/reassign-table` (move open tab), `POST /api/orders/:id/items` (add to open tab), cancellation already exists → extend to write a **coin/credit reconciliation** entry via `paymentPipeline` (refund to wallet when applicable).
- Audio ding metadata in socket payload (`new-order` includes `sound: true`).
**Frontend**
- Rework `/admin/orders` into a unified timeline with color-coded `orderType` tabs (Dine-in / Takeaway / Delivery / All), live transitions, audio on `new-order`, reassignment + add-items dialogs.

### Module #04 — Bills History & Digital Audit Ledger  ·  ✅ done
**Backend**
- Extend `Invoice`: `orderIds/sessionId`, `customerPhone`, `customerName`, `paymentMethods[]`, `gstBreakdown`, `totalAmount`, `status` (`closed`|`voided`), `createdByStaffId`; keep immutable.
- `services/auditService.js` — append-only `AuditLedger` collection (hash-chained: `prevHash`+`entryHash`) written on invoice close, discount, refund, drawer open.
- `GET /api/invoices/search?q=&from=&to=&method=` (by invoice id / phone / date / mode).
- `POST /api/invoices/:id/reprint` → regenerates PDF (existing `invoiceService`) or ESC/POS.
- `GET /api/invoices/export.csv` and `/export.xlsx` (CSV built natively; Excel via exceljs if approved — **check with user before adding a dependency**).
- `GET /api/reports/settlement?date=` → daily settlement for shift handover.
**Frontend**
- Upgrade `/admin/bills` and `/admin/sales` with search, date filters, reprint, export buttons; new `/admin/reports/settlement`.
**Security:** exports gated on `report.export`; ledger immutable (no update/delete routes).

### Module #05 — Menu Architecture & Variant Configuration  ·  ✅ done
**Backend**
- New models: `ModifierGroup` (`{cafeId, name, selectionType: single|multi, min, max, options[{name, price]})`, `VariantGroup` (sizes with price deltas), extend `Category` with `parentId` (sub-categories) and `MenuItem` with `modifierGroupIds[]`, `variantGroupIds[]`, `dietaryTags[]`, `ingredients[]`, `allergens[]`, `calories`, `prepStation` (kitchen|bar|both), `isOutOfStock`.
- Order item schema extended with chosen `variants[]` / `modifiers[]` and price resolved server-side.
- `PATCH /api/menu-items/:id/availability` — 1-tap 86 toggle, emits `menu-item-availability` socket → POS + QR update instantly.
**Frontend**
- `/admin/menu` upgrade: category tree, variant/modifier editors, dietary tag picker, availability toggle.
- Customer menu renders variant/modifier selection.

### Module #06 — Interactive Digital Menu Showcase  ·  ✅ done
**Backend**
- Extend `MenuItem` content fields (above); `GET /api/menu/search?q=` with autocomplete (regex + text index `{cafeId, name, description}`); image caching via Cloudinary transforms (already integrated).
**Frontend**
- `FoodCard` upgrade with photo gallery, calories, allergen warnings, ingredients, dish story; autocomplete search bar; lazy-loaded optimized images.

### Module #07 — Kitchen Display System (KDS)  ·  ✅ done
**Backend**
- `GET /api/kds/orders?station=` filters by `prepStation` + status; `PATCH /api/kds/items/:id/status` item-level bump; `PATCH /api/kds/orders/:id/bump`.
- `services/kdsMetrics.js` — avg prep time per station; expose via analytics.
- Socket events `kds-item-updated`, `kds-ticket-bumped`.
**Frontend**
- Rebuild `/admin/kitchen`: color urgency (green→amber→red from `createdAt`), station tabs (Barista/Grill), item-level toggles, audio dings, elapsed timers, metrics header.

### Module #08 — Staff & Role-Based Access Control  ·  ✅ done
**Backend**
- Extend `User`: roles `owner|manager|cashier|waiter|barista|staff`, `permissions[]`, `pinHash`, `shift`/`active`.
- `POST /api/auth/pin-login` (4-digit PIN, rate-limited), `POST /api/users/:id/pin` (manager sets).
- `Shift` model + `POST /api/shifts/open`, `/close` with cash float reconciliation; `drawer.open` permission.
- Permission middleware `requirePermission('order.refund')`.
**Frontend**
- `/admin/settings` staff & roles UI, permission matrix toggles, PIN management, fast cashier switch; shift open/close screen.
**Security:** PIN attempts rate-limited + lockout; permission checks always server-side.

### Module #09 — Customer CRM & Lifetime Intelligence  ·  ✅ done
**Backend**
- `Customer` model (F0.2). `GET /api/customers`, `GET /api/customers/:id`, `PATCH /api/customers/:id` (notes/dietary), `GET /api/customers/export.csv`.
- `customerService.upsertFromOrder()` — auto-create/match on phone or QR; recompute `visitCount`, `lifetimeSpend`, `favoriteItemIds`, `avgSpend` on settlement.
- Repeat-visit trigger hook (emit `customer-returned` when gap ≥ X days).
**Frontend**
- New `/admin/customers` list + profile page (visits, favorites, LTV, notes, timeline), export button.

### Module #10 — Geo-Location Fake-Order Prevention  ·  ✅ done
**Backend**
- Cafe geofence settings (F0.5).
- `POST /api/orders` (QR/dine-in path) validates `req.body.location {lat,lng,accuracy}` against `cafe.geofence` using Haversine; reject outside radius (configurable). Anti-spoof heuristics: accuracy sanity, impossible speed vs previous order, velocity limits per device/session.
- Fallback: if geolocation disabled → require staff confirm or soft-flag order (`flagged: true`) instead of hard reject (configurable).
**Frontend**
- `table/[tableId]` requests `navigator.geolocation` before ordering; friendly errors; staff review panel for flagged orders.
**Security:** purely server-side enforcement; client coordinates are advisory input only.

### Module #11 — Social NFC Physical Tap Integration  ·  ✅ done
**Backend**
- `NfcTag` model `{cafeId, label, destination: menu|google_review|instagram|custom, targetUrl, tableId?}`.
- `GET /api/nfc/:tagId` → resolves current destination (dynamic re-routing) and 302-redirects; scan analytics.
**Frontend**
- `/admin/settings` (or `/admin/qr`) NFC tag manager: create tag, set/change destination, download encoded URL/QR.
**Note:** physical hardware is out of scope (optional purchase); software = resolvable tag URLs.

### Module #12 — Contactless QR Table Ordering (extend existing)  ·  ✅ core exists
**Backend/Frontend**
- Ensure add-on ordering to active tab, UPI/card/netbanking payment hook via `paymentPipeline` + gateway (choose provider via Gravity Index before integrating).
- Dynamic table QR already present; verify per-table routing + no-registration flow.

### Module #13 — Waiter Handheld Mobile Ordering  ·  ✅ done
**Backend**
- Reuse `POST /api/orders` via `orderService` with `channel: waiter`, `createdByStaffId`, seat assignment on items.
- Waiter perf metrics (`orders taken`, turnover speed) surfaced to analytics.
**Frontend**
- New mobile-first `/staff/waiter` route (responsive web POS): table grid, quick search, modifier selection, seat assignment, fire-to-KDS.

### Module #14 — Smart Coupons & Promotional Discounts  ·  ✅ done
**Backend**
- `Coupon` model `{cafeId, code, type: percent|flat, value, minOrder, maxDiscount, categoryIds[], exclusions[], validFrom, validTo, happyHour {days, start, end}, singleUse, usageLimit, perCustomerLimit, active}`.
- `POST /api/coupons/validate` (public, guest-token aware) → returns computed discount; used by QR checkout and POS.
- Redemption recorded on order/session; single-use enforced against `Customer`.
**Frontend**
- `/admin/settings` (or new `/admin/coupons`) management; customer apply-coupon UI on cart/checkout + POS.

### Module #15 — Digital Loyalty Stamp System  ·  ✅ done
**Backend**
- `LoyaltyProgram` `{cafeId, name, stampsRequired, rewardType, rewardValue, qualifyingItemIds[]/categoryIds[], active}` + `LoyaltyCard` `{cafeId, customerId, stamps, milestones[], vouchers[]}`.
- Auto-stamp on settlement (`paymentPipeline`); unlock voucher at milestone; redeem voucher at next checkout.
- `GET /api/loyalty/me` (public by guest/customer), `POST /api/loyalty/redeem`.
**Frontend**
- Stamp-card UI on customer account/order-success; management in `/admin/settings`; wallet link/ SMS delivery via `emailService`/SMS provider (choose via Gravity Index).

### Module #16 — Interactive Scratch Cards & Surprise Rewards  ·  ✅ done
**Backend**
- `ScratchCampaign` `{cafeId, prizes[{type, value, weight, stock}], eligibleMinSpend, active, startAt, endAt}` + `ScratchCard` `{cafeId, customerId, orderId, prizeId, revealedAt, status}`.
- `POST /api/scratch/issue` (post-payment), `POST /api/scratch/:id/reveal` (server-side weighted draw; never send odds to client). Won voucher saved to `Customer`.
**Frontend**
- Scratch-off canvas animation + confetti on order success; admin campaign config.

### Module #17 — Customer Prepaid Store Wallet  ·  ✅ done
**Backend**
- `Wallet` `{cafeId, customerId, balance, currency}` + `WalletTransaction` `{type: topup|bonus|payment|refund, amount, balanceAfter, ref`. }`.
- `POST /api/wallet/topup` (payment gateway; bonus credit rules), `POST /api/wallet/pay` (1-tap checkout, idempotent, atomic via Mongo transactions or optimistic lock), `GET /api/wallet/me` passbook.
**Frontend**
- Wallet page/passbook on customer side; top-up flow; wallet tender option in POS + QR checkout.
**Security:** balance mutations atomic + idempotent; never allow negative balance; all topups verified with gateway webhook before crediting.

### Module #18 — Google AI-Powered Smart Review Engine  ·  ✅ done
**Backend**
- Cafe review settings (F0.5: `googlePlaceId`, `googleReviewUrl`, `aiEnabled`).
- `POST /api/reviews/prompt` — after settlement, capture 1–5 rating. Low score → private feedback record + manager alert (socket); high score → return AI-drafted review.
- `POST /api/reviews/draft` — AI-generated review from the customer's actual order (`Customer.favoriteItemIds` + order items). Choose LLM provider via Gravity Index; keep key server-side.
- `GET /api/reviews` manager view of private feedback.
**Frontend**
- Post-payment rating modal → deep-link to Google Business review dialog with prefilled draft; manager feedback inbox.
**Security:** AI key server-only; rate-limit drafts; no PII leakage to third party beyond order items.

---

## 5. Security baseline (applies to all modules)

- Validate every `cafeId`/ownership on read **and** write; never trust IDs in body for tenant scoping.
- Server-side recompute for prices, GST, discounts, loyalty, wallet.
- `clientRequestId` idempotency on order/payment/wallet/scratch endpoints.
- Rate-limit auth (PIN), coupon validation, review drafts, public lookups (extend `rateLimiter.js`).
- Audit ledger append-only; every discount/refund/void/drawer-open writes an entry.
- PCI/gateway: no card data touches our servers — tokenized gateway fields only; wallet top-ups credited only on verified webhook.
- Secrets (`JWT_SECRET`, gateway keys, AI key) in env only.

---

## 6. Verification per phase

1. `cd frontend && npx tsc --noEmit` and `npm run build` clean.
2. Backend: Jest tests for each new controller (mock models, follow existing `__tests__` conventions); `npm test`.
3. Real-time smoke: place an order from QR + POS, confirm POS/KDS/orders/dashboard receive socket events.
4. Tenant isolation test: two cafes, confirm no cross-tenant reads/writes.
5. Money test: crafted client payload with fake prices/discounts rejected server-side.

---

## 7. Open decisions (need user input)

1. **Payment gateway** for QR pay / wallet top-up / UPI (Razorpay, Stripe, PhonePe…).
2. **Excel export dependency** (exceljs) vs CSV-only.
3. **SMS provider** for loyalty wallet links / review prompts.
4. **LLM provider** for the AI review engine (Module #18).
5. **Printing transport priority** — Web Bluetooth / WebUSB / network bridge.

> Providers will be selected through Gravity Index (not from memory) before integration.

---

## 8. Progress log

### Phase 0 — Foundations (DONE, backend)
- `constants/permissions.js` + `middlewares/permissionMiddleware.js` — granular RBAC with role defaults and per-user override.
- Models extended: `Cafe` (geofence/review/loyalty/receipt/currency/timezone), `User` (roles cashier/waiter/barista, `permissions`, `pinHash`, `isActive`), `Order` (`orderType`, `channel`, `customerId`, `createdByStaffId`, `paymentStatus`, `payments`, `discounts`, `geolocation`, optional `tableId` for non-dine-in).
- New models: `Customer`, `AuditLedger`.
- New services: `orderService` (shared engine), `customerService`, `auditService`, `printService`.
- `orderController` refactored onto `orderService`; QR flow unchanged (all 170 tests still pass).

### Phase 1 — Commerce core
**Backend (DONE)**
- #05: `MenuItem.variants`, `modifierGroups`, `dietaryTags`, `ingredients`, `allergens`, `calories`, `prepStation`; `PATCH /api/menu/:id/availability` (86 toggle, socket broadcast); `GET /api/menu/public/search` (autocomplete). Order items persist chosen modifiers/station/seat/notes and are re-priced server-side.
- #02: `GET /api/pos/catalog`, `POST /api/pos/orders`, `POST /api/pos/orders/:id/payments` (split cash/UPI/card/wallet), `POST /api/pos/orders/:id/discounts`, `GET /api/pos/orders/:id/receipt` (ESC/POS + reprint audit).
- #03: omnichannel filters on `getOrders` (`orderType`, `channel`, `paymentStatus`).
- #07: `GET /api/kds/orders?station=`, `PATCH /api/kds/orders/:orderId/items/:itemId/status`, `PATCH /api/kds/orders/:orderId/bump` + socket events.
- #01: `GET /api/analytics/live` (revenue, active tickets, influx, fulfillment time, breakdown, peak hours).

**Frontend (DONE)**
- #02: `/admin/pos` touch POS (catalog grid, variant/modifier modal, cart, discounts, split-payment modal, thermal receipt print preview) + sidebar nav + `actions/pos.ts`.
- #07: `/admin/kitchen` rebuilt as KDS (station tabs, Green→Amber→Red urgency, live elapsed timers, item-level bump, ticket bump, audio ding, avg prep time) + `actions/kds.ts`.
- #03: `/admin/orders` omnichannel type tabs (All / Dine-in / Takeaway / Delivery).
- #01: `LiveTelemetry` widget on `/admin/analytics` (8s polling).
- Types + menu actions extended for variants/modifiers/availability/search.

**Verification:** backend 170/170 tests pass; `tsc --noEmit` clean; `next build` clean.

**Phase 1 remaining**
- Unit/integration tests for POS, KDS, orderService pricing, and permissions (see “Remaining” below).
- Waiter handheld UI (#13) reusing the POS components — **shipped**, see the #13 section below.

**Note:** the menu variant/modifier **editor UI** shipped — see “Menu editor UI (DONE)” below.

### Menu editor UI (DONE)
- New `MenuCatalogFields` component: variant/size editor (with default selection), modifier group editor (single/multi, priced options), dietary tags, allergens, ingredients, calories, and prep-station routing.
- Wired into both Add and Edit item modals in `MenuManagementClient`; `menu` actions and `menu/page.tsx` mapping extended.

### Customer CRM — Module #09 (DONE)
**Backend** — `customerController` + `customerRoutes`: list (search/sort/paginate), profile + order history, update (notes/dietary/tags/birthday), CSV export. Visit recording hooked into POS settlement and the session payment pipeline (visits, lifetime spend, avg spend, favorites).
**Frontend** — `/admin/customers` directory with search, sort, CSV export, and a profile drawer (metrics, editable dietary/notes, recent orders) + `actions/customers.ts` + sidebar nav.

### Phase 2 — Bills history, tax export, audit ledger (DONE)
**Backend** — `billingController`: `GET /api/billing/bills/search`, `GET /api/billing/bills/export` (tax CSV), `GET /api/billing/settlement`. New `auditController` + `GET /api/audit`. Ledger entry `invoice.closed` written on bill close.
**Frontend** — `/admin/audit` combined screen: Bills History tab (search by invoice/customer, payment + date filters, settlement reconciliation, tax CSV export, invoice reprint) and Digital Audit Ledger tab (immutable entries with hash) + sidebar nav.

### Staff PIN & Shift/Drawer — Module #08 (DONE)
**Backend** — `Shift` model (`{cafeId, openedBy, openingFloat, closingFloat, expectedCash, cashSales, totalSales, paymentsBreakdown, difference, status}`) + `shiftService` (aggregates POS `Order.payments[]` and counter-settled `DiningSession`s over the shift window) + `shiftController`/`shiftRoutes` (`GET /api/shifts/current`, `POST /api/shifts/open`, `POST /api/shifts/:id/close`, `GET /api/shifts`) gated by `drawer.open`/`report.view`. `POST /api/auth/pin-login` (bcrypt PIN, per-user lockout after 5 failures + IP `pinLimiter`) and `GET /api/auth/operators` on the authenticated device; `POST/DELETE /api/users/:id/pin` + `GET /api/users/permissions`; `updateStaffUser` (roles/permissions/active); audit entries `shift.opened`/`shift.closed`; `emitShiftUpdated` socket.
**Frontend** — `/admin/shift` (open drawer with float, live expected-cash + payment breakdown, close with counted cash and live variance, shift history) + `actions/shifts.ts`; `/admin/lock` PIN lock/operator-switch screen (operator grid + numeric keypad, swaps `admin_token`) + `switchOperator`/`getOperators` actions; Settings staff table with all assignable roles, PIN set/clear modals, and active-toggle; sidebar nav for “Shift & Drawer” and “Switch Operator”.
**Verification** — `__tests__/shifts.test.js` + `__tests__/pin.test.js` (15 tests); full backend suite 185/185 across 9 suites; `tsc --noEmit` clean; `next build` clean.

### Phase 4 — Coupons (#14), Loyalty (#15), Wallet (#17) (DONE)
**Backend** — New models `Coupon`, `LoyaltyProgram`, `LoyaltyCard`, `Wallet`, `WalletTransaction`. Services: `couponService` (validation engine + redemption counters), `loyaltyService` (stamp earning, voucher issue/redeem, manager adjust), `walletService` (atomic conditional debit, idempotent credit/debit, passbook). Controllers/routes: `/api/coupons` (CRUD + `validate`), `/api/loyalty` (program, cards, voucher validate/redeem, public `/me`), `/api/wallet` (guest `me`/`pay`) and `/api/wallets` (admin list/detail/topup/refund). Integration: `orderService.createOrder` accepts a server-validated `couponCode`; POS applies coupons + loyalty vouchers and debits the wallet on a `wallet` tender; loyalty stamps earned on POS settlement and the session payment pipeline; `emitLoyaltyUpdated`/`emitWalletUpdated` sockets; audit entries `loyalty.*` and `wallet.*`.
**Frontend** — `/admin/coupons` (CRUD list), `/admin/loyalty` (program config, member cards with stamp progress, adjust stamps, voucher validate/redeem), `/admin/wallets` (balances, top-up with bonus, refund, passbook) + sidebar nav; POS coupon/voucher fields and wallet tender; customer stamp card + wallet balance on the order-success page (guest-token scoped, no session id leaked).
**Verification** — `__tests__/phase4.test.js` (16 tests across the three services); full backend suite 201/201 across 10 suites; `tsc --noEmit` clean; `next build` clean with `/admin/coupons`, `/admin/loyalty`, `/admin/wallets`.

### Waiter Handheld (#13) & Scratch Cards (#16) (DONE)
**Backend (#13)** — `waiterController`/`waiterRoutes` (`GET /api/waiter/tables`, `POST /api/waiter/orders`, `GET /api/waiter/metrics`) reusing `orderService` with `channel: waiter`, seat assignment, auto-opening a dining session for the table, and waiter audit/metrics.
**Backend (#16)** — `ScratchCampaign`/`ScratchCard` models + `scratchService` (issue on settlement with min-spend and daily/per-customer caps, weighted server-side draw, stock depletion, voucher issuance via `loyaltyService.issueVoucher`) + `scratchController`/`scratchRoutes` (`/campaign`, `/cards`, admin reveal, guest `/me` and `/:id/reveal`); new `scratch.manage` permission; `emitScratchIssued`/`emitScratchRevealed`; issue hooks in POS settlement and the session payment pipeline.
**Frontend** — mobile-first `/staff/waiter` (table grid with live totals, searchable menu, seat selector, fire-to-kitchen, today's metrics) with `/staff/:path*` middleware protection and a sidebar “Waiter Mode” launcher; `/admin/scratch` (prize-pool editor with weights, campaign settings, issued-card list with reveal) + sidebar nav; customer scratch-off canvas (`ScratchReveal`) on the order-success page.
**Verification** — `__tests__/scratch.test.js` (12 tests); full backend suite 213/213 across 11 suites; `tsc --noEmit` clean; `next build` clean with `/admin/scratch` and `/staff/waiter`.

### Geo-location Fake-Order Prevention — Module #10 (DONE)
**Backend** — `services/geofenceService.js` (haversine distance, coordinate sanity, accuracy heuristics, impossible-travel + burst velocity checks, risk score, `accept`/`flag`/`reject` verdict) called from the shared `orderService.createOrder` so enforcement is identical on every guest-facing surface. `Cafe.geofence` gained `flagThreshold`/`velocityLimit`; `Order.geolocation` now snapshots distance, radius, risk score, reason codes, velocity signals and the manager's triage outcome. `geofenceController` + `geofenceRoutes` (`geofence.manage`): `GET/PUT /config`, `GET /flags`, `POST /flags/:id/resolve`, `GET /stats`. Flagged orders write an `order.geofence_flagged` audit entry and emit `geofence-flagged`.
**Rules** — client coordinates are advisory only; the verdict is always recomputed server-side. A denied/ missing fix flags rather than blocks by default (`fallback: flag|reject`). POS and waiter orders skip enforcement (`enforceGeofence: false`) because staff are on the premises.
**Frontend** — `lib/geolocation.ts` asks once at checkout and never blocks ordering; `/admin/geofence` Fraud Watch screen (radius config, "use this device's location", stats, flagged-order triage queue with reason codes).
**Verification** — `__tests__/geofence.test.js` (21 tests: distance maths, each verdict, spoof/velocity heuristics, config validation, tenant-scoped queue, triage).

### Social NFC Tap Integration — Module #11 (DONE)
**Backend** — new `NfcTag` model `{cafeId, tagId, label, destination(menu|google_review|instagram|custom), targetUrl, tableId, isActive, tapCount, lastTapAt}`. `services/nfcService.js` resolves a tap **at tap time**, which is what lets a sticker be re-pointed without re-printing. Public `GET /api/nfc/:tagId` → 302 to the live destination + tap analytics + `nfc-tapped` socket. Admin routes under `/api/nfc/manage` (`nfc.manage`): CRUD, `/manage/:id/card`, `/manage/:tagId/resolve`, `/stats`.
**Frontend** — `/admin/nfc`: create/bind/edit tags, sticker card with the resolver URL + NDEF URI record + QR of the same URL, **Web NFC write button where the browser supports it**, and a permanent QR fallback for phones that cannot read NFC or decline the permission prompt. Tap counts per tag show whether a sticker is still in the field.
**Verification** — `__tests__/nfc.test.js` (20 tests: payload shape, every destination, live re-pointing, unknown/inactive tags, tenant scoping, validation, redirect behaviour).

### Smart Review Engine — Module #18 (DONE)
**Backend** — new `Review` model (rating, controlled-vocabulary tags, comment, visibility, status, `ai{}` block, owner reply, internal note). `services/geminiService.js` wraps Google Gemini defensively: server-side key only, lazy SDK load, never throws — callers get `{ok, data|reason}` and the feature degrades to templates. `services/reviewService.js` routes a rating at/above `cafe.review.minRatingForGoogle` to a public draft generated from what the customer actually ordered, and anything lower to private feedback plus an instant manager alert via the new channel-based `services/notificationService.js` (`in_app` + `email`; `sms` reserved as a registration seam). Routes: public rate-limited `POST /api/reviews` (guest-token scoped), manager `/settings`, `/all`, `/summary`, `/:id/draft`, `/:id/reply-draft`, `/:id/reply`, `PATCH /:id`.
**Frontend** — `<RatingPrompt />` on the order-success page (stars, tags, comment, then a copyable AI draft + Google deep link for happy guests, a plain thank-you for the rest) and `/admin/reviews` (rating mix, top themes, AI digest of low ratings, triage inbox, draft/reply generation, settings).
**Verification** — `__tests__/reviews.test.js` (19 tests), including the no-API-key path so the module is proven to work without Gemini.

### Module #01/#03/#06 completion
- **#01** — `services/telemetryService.js` now owns `GET /api/analytics/live`, plus `/peak-hours` (hourly orders/revenue/ticket + day-of-week heatmap), `/turnover` (sessions per table, dwell time, occupancy, busiest tables) and `/outlets` (cross-cafe roll-up that re-verifies ownership per outlet and hides the rest). `emitRefresh` throttles `metrics-updated` to 1/sec/café and fires on new orders, status changes and `session-paid`. `LiveTelemetry` is now socket-driven with a rolling recharts graph and a 30s poll backstop; new `OperationsInsights` tab renders peak hours, heatmap, turnover and outlet comparison.
- **#03** — `services/orderReconciliationService.js` with `recomputeTotals` (recomputed from live items, percentage discounts kept proportional), `addItemsToOrder` (server-repriced), `reassignTable` (moves the order *and* its dining session, refuses a table that is settling) and `reconcileRefund` (capped at what was collected, wallet refunds credit the real balance, `order.refund` ledger entry). Routes `POST /api/orders/:id/items`, `PATCH /:id/reassign-table`, `POST /:id/refund`. `new-order` payloads now carry `meta {sound, channel, orderType, flagged}`; `lib/orderAudio.ts` synthesises the ding (no asset) and the board adds channel/payment/search filters plus per-ticket action dialogs.
- **#06** — `MenuItem` gained `story`, `media[]`, `allergenNote`, `spiceLevel`, `prepMinutes`. New `DishDetailSheet` (gallery, story, ingredients, allergen breakdown, variant/modifier picker with required-group validation), badges on `FoodCard` (calories, prep time, dietary, spice, allergen warning), search now matches ingredients/tags/allergens, and the customer menu finally receives the full catalog definition. Admin gets `MenuShowcaseFields`. The cart now carries the guest's variant/modifier choice (`CartItem.variantId/modifiers/unitPrice`, composite line key) and checkout submits it — prices are still ignored from the client and re-resolved server-side.
- **Refactor** — `services/qrService.js` extracted: table guest URLs, NFC resolver URLs, Google review deep links, QR data URLs and table identity generation now live in one place, used by the table and NFC controllers.
- **Permissions** — added `geofence.manage`, `nfc.manage`, `review.manage`, `review.response`.

### Test coverage closed
`__tests__/geofence.test.js` (21), `nfc.test.js` (20), `reviews.test.js` (19), `permissions.test.js` (18 — RBAC catalog, `requirePermission`/`requireAnyPermission`, tenant isolation), `commerce.test.js` (26 — POS catalog/payments/split tenders/wallet debit + KDS station routing and item/ticket bumps), `crm-ledger.test.js` (16 — CRM search escaping, allow-listed profile writes, CSV quoting + the audit ledger hash chain). **Suite: 352 tests across 18 files, all passing.** Two real defects were found and fixed while writing them: the KDS item lookup threw on documents without Mongoose subdoc ids, and the refund path reported a confusing zero-cap error instead of "nothing was collected".

### Remaining (deliberately out of scope)
- **Deferred by decision** — payment gateway (cash + manual UPI/card only for now); `.xlsx` export (CSV only); SMS channel (the `notificationService` seam is ready, but it needs a provider account + DLT registration).
- **Optional enhancements** — reusable cross-item modifier groups (groups are currently embedded per menu item); IP-geolocation as a second geofence signal (the server hook is in place, it needs a paid provider).
- **Ops note** — NFC provisioning needs a browser with Web NFC (Android Chrome) or any NDEF writer app; the QR fallback covers every other phone.
