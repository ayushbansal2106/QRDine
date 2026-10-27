const asyncHandler = require('../utils/asyncHandler');
const planFeatureConfigService = require('../services/planFeatureConfigService');

/**
 * Plan-wise feature configuration (the control plane's Plan Configuration).
 *
 * Reads and writes the persisted plan → feature/limit mapping. The write path
 * is superadmin-only and CSRF-protected at the router; the read path is
 * available to support and readonly operators, like the rest of the control
 * plane's read surface.
 *
 * Nothing here reads a plan name, a price or an entitlement map out of the
 * request body and believes it: the plan identifiers are validated against
 * the catalogue, the feature keys against the registry, and the values against
 * the limit rules. The operator's identity comes from the verified super-admin
 * token, never from the payload.
 */

/**
 * The matrix: one column per paid plan, one row per registered feature.
 *
 * Every value is the effective one — the catalogue default with the persisted
 * configuration merged over it — so the operator is editing what a tenant on
 * that plan actually gets, not a wish list.
 */
const getPlanConfig = asyncHandler(async (req, res) => {
  const matrix = await planFeatureConfigService.buildPlanFeatureMatrix();

  res.status(200).json({
    success: true,
    ...matrix,
  });
});

/**
 * Save the plan configuration.
 *
 * `plans` carries only the plans that changed, each with the feature and
 * limit values for that plan and the version it was loaded at. The service
 * validates the whole payload before writing anything, refuses a stale
 * version with a 409 rather than overwriting another administrator's change,
 * and returns the authoritative matrix so the interface can replace its draft
 * with what was actually stored.
 */
const savePlanConfig = asyncHandler(async (req, res) => {
  const { plans, note = '' } = req.body || {};

  const matrix = await planFeatureConfigService.savePlanFeatureConfig({
    plans,
    actor: req.superAdmin.email,
    note: String(note || '').slice(0, 300),
  });

  res.status(200).json({
    success: true,
    message: 'Plan configuration saved.',
    ...matrix,
  });
});

module.exports = {
  getPlanConfig,
  savePlanConfig,
};
