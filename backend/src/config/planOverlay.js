/**
 * Runtime overlay for the plan catalogue.
 *
 * ── What this is ─────────────────────────────────────────────────────────
 * `config/plans.js` is the *baseline* catalogue: the plan table a fresh install
 * ships with. The control plane can change what a plan includes at runtime
 * (Plan Configuration → "Subscription Plan Configuration"), and that change has
 * to be persisted, not held in a React component.
 *
 * This module is the tiny, dependency-free place where the persisted
 * configuration is parked in memory so that the *synchronous* parts of the
 * codebase — `quote()`, `publicCatalogue()`, `computeAccess()` — can read it
 * without turning into async functions. It holds no logic of its own: the
 * shape of the data is owned by `services/planFeatureConfigService.js`, and
 * the catalogue that reads it lives in `config/plans.js`.
 *
 * It exists as its own module purely to keep the dependency graph acyclic:
 * `config/plans.js` must not require the service that writes the overlay,
 * because the service requires the catalogue for its defaults.
 *
 * ── Why it is safe ───────────────────────────────────────────────────────
 * The overlay only ever *narrows or widens what a plan grants*. It never
 * touches subscription status, usage counters, or the global feature catalog,
 * so a stale overlay can never hand a lapsed tenant paid features.
 */
let overlay = new Map();

/**
 * Replace the whole overlay.
 *
 * @param {Map<string, {features?: Object, limits?: Object, includedOutlets?: number|null}>} entries
 */
const setOverlay = (entries) => {
  overlay = entries instanceof Map ? entries : new Map(entries || []);
};

/** The overlay entry for one plan, or null when the plan is untouched. */
const getOverlay = (planKey) => overlay.get(planKey) || null;

/** Drop every overlay entry (used when the persisted configuration is cleared). */
const clearOverlay = () => {
  overlay = new Map();
};

/** True when the plan has a persisted configuration. */
const hasOverlay = (planKey) => overlay.has(planKey);

module.exports = {
  setOverlay,
  getOverlay,
  clearOverlay,
  hasOverlay,
};
