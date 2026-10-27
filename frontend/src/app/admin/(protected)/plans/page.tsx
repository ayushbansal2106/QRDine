"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getPlanMatrix,
  savePlanMatrix,
  type PlanChange,
  type PlanLimitRow,
  type PlanMatrix,
  type PlanMatrixPlan,
} from "@/actions/planConfig";

/**
 * Plan Configuration — the plan-wise feature matrix.
 *
 * ── What this page edits ────────────────────────────────────────────────
 * What each *plan* includes. One column per paid plan, one row per
 * registered feature, and every cell is an independent entitlement for that
 * plan. Switching loyalty on for Growth does not touch Starter.
 *
 * ── What this page does NOT edit ────────────────────────────────────────
 * The global feature catalog, which is a platform-wide availability override
 * and lives on its own page. The two are applied in that order and a global
 * block wins over a plan entitlement — so a cell that is switched on here can
 * still be closed platform-wide. The banner below says so when it happens,
 * because "the switch does nothing" is otherwise a support ticket.
 *
 * ── Draft state ─────────────────────────────────────────────────────────
 * Edits are held locally until they are saved. That is not a nicety: a plan
 * change reprices every subscriber on that plan, so a half-finished edit must
 * not reach the database. "Discard" throws the draft away; "Save" sends only
 * the plans that actually changed, each with the version it was loaded at, so
 * a concurrent edit by another administrator is refused rather than silently
 * overwritten.
 */

interface PlanDraft {
  features: Record<string, boolean>;
  limits: Record<string, number | null>;
}

type Drafts = Record<string, PlanDraft>;

interface Notice {
  tone: "ok" | "error";
  text: string;
}

/** A limit value that the server would reject. */
interface LimitProblem {
  planKey: string;
  limitKey: string;
  message: string;
}

const GROUP_LABELS: Record<string, string> = {
  counter: "Counter",
  operations: "Operations",
  billing: "Billing",
  reporting: "Reporting",
  marketing: "Marketing",
  risk: "Risk",
  support: "Support",
};

const formatPaise = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);

/** The draft for one plan, seeded from what the server sent. */
const draftFromPlan = (plan: PlanMatrixPlan): PlanDraft => ({
  features: { ...plan.features },
  limits: { ...plan.limits },
});

const draftsFromMatrix = (matrix: PlanMatrix): Drafts => {
  const drafts: Drafts = {};
  for (const plan of matrix.plans) {
    drafts[plan.key] = draftFromPlan(plan);
  }
  return drafts;
};

/** The plans whose draft differs from the last state the server confirmed. */
const changedPlanKeys = (matrix: PlanMatrix, drafts: Drafts): string[] =>
  matrix.plans
    .filter((plan) => {
      const draft = drafts[plan.key];
      if (!draft) return false;
      if (plan.configured === false) {
        // A plan that was never saved counts as changed only if it differs
        // from the catalogue default the operator is looking at.
        return (
          Object.keys(draft.features).some(
            (key) => draft.features[key] !== plan.features[key]
          ) ||
          Object.keys(draft.limits).some(
            (key) => draft.limits[key] !== plan.limits[key]
          )
        );
      }
      return (
        Object.keys(plan.features).some(
          (key) => draft.features[key] !== plan.features[key]
        ) ||
        Object.keys(plan.limits).some((key) => draft.limits[key] !== plan.limits[key])
      );
    })
    .map((plan) => plan.key);

export default function SuperAdminPlansPage() {
  const [matrix, setMatrix] = useState<PlanMatrix | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const applyMatrix = useCallback((next: PlanMatrix) => {
    setMatrix(next);
    setDrafts(draftsFromMatrix(next));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    const result = await getPlanMatrix();
    if (result.success && result.matrix) {
      applyMatrix(result.matrix);
    } else {
      setNotice({
        tone: "error",
        text: result.message || "Could not load the plan configuration.",
      });
    }
    setLoading(false);
  }, [applyMatrix]);

  useEffect(() => {
    let cancelled = false;
    getPlanMatrix().then((result) => {
      if (cancelled) return;
      if (result.success && result.matrix) {
        applyMatrix(result.matrix);
      } else {
        setNotice({
          tone: "error",
          text: result.message || "Could not load the plan configuration.",
        });
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [applyMatrix]);

  /** Toggle one feature for one plan. */
  const toggleFeature = (planKey: string, featureKey: string) => {
    setDrafts((prev) => {
      const plan = prev[planKey];
      if (!plan) return prev;
      return {
        ...prev,
        [planKey]: {
          ...plan,
          features: {
            ...plan.features,
            [featureKey]: !plan.features[featureKey],
          },
        },
      };
    });
  };

  /** Set one limit for one plan. */
  const setLimit = (planKey: string, limitKey: string, value: number | null) => {
    setDrafts((prev) => {
      const plan = prev[planKey];
      if (!plan) return prev;
      return {
        ...prev,
        [planKey]: {
          ...plan,
          limits: { ...plan.limits, [limitKey]: value },
        },
      };
    });
  };

  const changedKeys = useMemo(
    () => (matrix ? changedPlanKeys(matrix, drafts) : []),
    [matrix, drafts]
  );

  const limitProblems = useMemo(() => {
    const problems: LimitProblem[] = [];
    if (!matrix) return problems;

    for (const plan of matrix.plans) {
      const draft = drafts[plan.key];
      if (!draft) continue;

      for (const row of matrix.limitRows) {
        const value = draft.limits[row.key];
        if (value === null || value === undefined) {
          if (!row.unlimitedAllowed) {
            problems.push({
              planKey: plan.key,
              limitKey: row.key,
              message: `${row.label} is required for ${plan.name}.`,
            });
          }
          continue;
        }
        if (!Number.isInteger(value) || value < row.min || value > row.max) {
          problems.push({
            planKey: plan.key,
            limitKey: row.key,
            message: `${row.label} for ${plan.name} must be a whole number between ${row.min} and ${row.max}.`,
          });
        }
      }
    }
    return problems;
  }, [matrix, drafts]);

  const problemFor = (planKey: string, limitKey: string) =>
    limitProblems.find((p) => p.planKey === planKey && p.limitKey === limitKey);

  const discard = () => {
    if (!matrix) return;
    setDrafts(draftsFromMatrix(matrix));
    setNotice(null);
  };

  const save = async () => {
    if (!matrix || changedKeys.length === 0) return;

    setSaving(true);
    setNotice(null);

    const changes: PlanChange[] = changedKeys.map((planKey) => {
      const plan = matrix.plans.find((p) => p.key === planKey);
      const draft = drafts[planKey];

      // Send only what changed, so an unrelated cell cannot be clobbered by a
      // stale draft value.
      const features: Record<string, boolean> = {};
      for (const key of Object.keys(draft.features)) {
        if (draft.features[key] !== plan?.features[key]) {
          features[key] = draft.features[key];
        }
      }
      const limits: Record<string, number | null> = {};
      for (const key of Object.keys(draft.limits)) {
        if (draft.limits[key] !== plan?.limits[key]) {
          limits[key] = draft.limits[key];
        }
      }

      return {
        planKey,
        expectedVersion: plan?.version,
        features,
        limits,
      };
    });

    const result = await savePlanMatrix(changes);
    if (result.success && result.matrix) {
      applyMatrix(result.matrix);
      setNotice({
        tone: "ok",
        text: `Saved ${result.changedPlans.length} plan${
          result.changedPlans.length === 1 ? "" : "s"
        }.`,
      });
    } else {
      setNotice({
        tone: "error",
        text: result.message || "Could not save the plan configuration.",
      });
    }
    setSaving(false);
  };

  const renderLimitCell = (plan: PlanMatrixPlan, row: PlanLimitRow) => {
    const draft = drafts[plan.key];
    if (!draft) return null;
    const value = draft.limits[row.key];
    const problem = problemFor(plan.key, row.key);
    const canBeUnlimited = row.unlimitedAllowed;

    return (
      <div className="flex flex-col items-center gap-1">
        <input
          type="number"
          min={row.min}
          max={row.max}
          value={value === null || value === undefined ? "" : value}
          disabled={saving}
          placeholder={canBeUnlimited ? "∞" : String(row.min)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              // An empty field means "no cap" only where that is legal.
              setLimit(plan.key, row.key, canBeUnlimited ? null : null);
              return;
            }
            const parsed = Number(raw);
            setLimit(plan.key, row.key, Number.isFinite(parsed) ? parsed : null);
          }}
          className={`w-24 bg-[#1b1c1c] border rounded-lg px-2 py-1.5 text-sm text-white text-center focus:outline-none focus:border-[#51604f] disabled:opacity-50 ${
            problem ? "border-[#ba1a1a]" : "border-[#444842]"
          }`}
        />
        {canBeUnlimited && (
          <label className="flex items-center gap-1 text-[10px] text-[#5e5e5b] cursor-pointer">
            <input
              type="checkbox"
              checked={value === null}
              disabled={saving}
              onChange={(e) =>
                setLimit(plan.key, row.key, e.target.checked ? null : row.min)
              }
              className="accent-[#51604f]"
            />
            unlimited
          </label>
        )}
        {problem && (
          <p className="text-[10px] text-[#ff8989] text-center max-w-[12rem]">
            {problem.message}
          </p>
        )}
      </div>
    );
  };

  const renderFeatureCell = (plan: PlanMatrixPlan, featureKey: string) => {
    const draft = drafts[plan.key];
    if (!draft) return null;
    const enabled = Boolean(draft.features[featureKey]);
    const blockedGlobally = Boolean(
      matrix?.globalAvailability.blocked[featureKey]
    );
    const baseline = Boolean(plan.baselineFeatures[featureKey]);
    const changed = enabled !== baseline;

    return (
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => toggleFeature(plan.key, featureKey)}
          disabled={saving}
          aria-pressed={enabled}
          aria-label={`${enabled ? "Disable" : "Enable"} ${featureKey} for ${plan.name}`}
          className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 ${
            enabled ? "bg-[#51604f]" : "bg-[#444842]"
          }`}
        >
          <span
            className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : ""
            }`}
          />
        </button>
        {changed && (
          <span className="text-[10px] text-[#8fbf8a]">changed</span>
        )}
        {blockedGlobally && (
          <span
            title="Globally blocked for every plan — this switch has no effect until the block is lifted."
            className="text-[10px] text-[#ff8989] cursor-help"
          >
            blocked
          </span>
        )}
      </div>
    );
  };

  const plans = matrix?.plans ?? [];
  const features = matrix?.features ?? [];
  const limitRows = matrix?.limitRows ?? [];

  const featuresByGroup = (group: string) =>
    features.filter((feature) => feature.group === group);

  const groupsInUse = matrix?.groups.filter((group) =>
    featuresByGroup(group).length > 0
  ) ?? [];

  return (
    <div className="max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Plan Configuration</h1>
          <p className="text-[#e1dfdb]">
            What each subscription plan includes. Every cell is an independent
            entitlement for that plan.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading || saving}
          aria-label="Reload the plan configuration"
          className="p-2 bg-[#2a2c2c] border border-[#444842] rounded-lg hover:bg-[#444842] transition-colors disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[#e1dfdb]">refresh</span>
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className={`mb-6 p-4 rounded-xl border text-sm ${
            notice.tone === "ok"
              ? "bg-[#51604f]/20 border-[#51604f]/50 text-[#b8c9b5]"
              : "bg-[#ba1a1a]/20 border-[#ba1a1a]/50 text-[#ff8989]"
          }`}
        >
          {notice.text}
        </div>
      )}

      {loading ? (
        <div className="bg-[#2a2c2c] border border-[#444842] rounded-2xl p-10 text-center text-[#e1dfdb]">
          <span className="material-symbols-outlined animate-spin text-3xl inline-block mr-2">
            progress_activity
          </span>
          Loading plan configuration…
        </div>
      ) : !matrix ? (
        <div className="bg-[#2a2c2c] border border-[#444842] rounded-2xl p-10 text-center text-[#e1dfdb]">
          The plan configuration could not be loaded.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Global availability — a separate layer, shown so the operator
              knows why a switch may appear to do nothing. */}
          {matrix.globalAvailability.exists && (
            <div className="bg-[#2a2c2c] border border-[#444842] rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[#8fbf8a]">
                  public
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Platform-wide availability overrides are active
                  </h2>
                  <p className="text-xs text-[#5e5e5b] mt-1">
                    These apply to every plan and are managed separately on the
                    Feature Catalog page. A global block wins over a plan
                    entitlement — a feature marked &ldquo;blocked&rdquo; below
                    stays closed however it is set here.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── The matrix ─────────────────────────────────────────── */}
          <div className="bg-[#2a2c2c] border border-[#444842] rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[#444842] bg-[#1b1c1c]/50">
                    <th className="p-4 text-left text-sm font-semibold text-[#e1dfdb] min-w-[16rem]">
                      Feature
                    </th>
                    {plans.map((plan) => (
                      <th
                        key={plan.key}
                        className="p-4 text-center text-sm font-semibold text-[#e1dfdb] min-w-[9rem]"
                      >
                        <p className="text-white">{plan.name}</p>
                        <p className="text-[11px] text-[#5e5e5b] font-normal mt-0.5">
                          {formatPaise(plan.pricing.monthly.paise)}/mo
                        </p>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupsInUse.map((group) => (
                    <>
                      <tr
                        key={`group-${group}`}
                        className="border-b border-[#444842] bg-[#1b1c1c]/30"
                      >
                        <td
                          colSpan={plans.length + 1}
                          className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[#8fbf8a]"
                        >
                          {GROUP_LABELS[group] || group}
                        </td>
                      </tr>
                      {featuresByGroup(group).map((feature) => (
                        <tr
                          key={feature.key}
                          className="border-b border-[#444842] last:border-b-0 hover:bg-[#444842]/10 transition-colors"
                        >
                          <td className="p-4">
                            <p className="text-sm text-white">
                              {feature.label}
                              {feature.core && (
                                <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#e1dfdb]/60">
                                  core
                                </span>
                              )}
                            </p>
                            {feature.description && (
                              <p className="text-xs text-[#5e5e5b] mt-0.5">
                                {feature.description}
                              </p>
                            )}
                          </td>
                          {plans.map((plan) => (
                            <td key={plan.key} className="p-4 text-center">
                              {renderFeatureCell(plan, feature.key)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </>
                  ))}

                  {/* Limits */}
                  <tr className="border-b border-[#444842] bg-[#1b1c1c]/30">
                    <td
                      colSpan={plans.length + 1}
                      className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[#8fbf8a]"
                    >
                      Limits
                    </td>
                  </tr>
                  {limitRows.map((row) => (
                    <tr
                      key={row.key}
                      className="border-b border-[#444842] last:border-b-0 hover:bg-[#444842]/10 transition-colors"
                    >
                      <td className="p-4">
                        <p className="text-sm text-white">{row.label}</p>
                        {row.description && (
                          <p className="text-xs text-[#5e5e5b] mt-0.5">
                            {row.description}
                          </p>
                        )}
                      </td>
                      {plans.map((plan) => (
                        <td key={plan.key} className="p-4 text-center">
                          {renderLimitCell(plan, row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Save ───────────────────────────────────────────────── */}
          <div className="bg-[#2a2c2c] border border-[#444842] rounded-2xl p-5 flex flex-col md:flex-row md:items-center gap-4 justify-between">
            <div>
              <p className="text-sm text-white">
                {changedKeys.length === 0
                  ? "No unsaved changes"
                  : `${changedKeys.length} plan${
                      changedKeys.length === 1 ? "" : "s"
                    } changed: ${changedKeys
                      .map((key) => plans.find((p) => p.key === key)?.name || key)
                      .join(", ")}`}
              </p>
              <p className="text-xs text-[#5e5e5b] mt-1">
                Saving applies to every subscriber on the plans you changed.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={discard}
                disabled={saving || changedKeys.length === 0}
                className="px-5 py-2 bg-[#444842]/50 text-[#e1dfdb] border border-[#444842] rounded-lg text-sm font-semibold hover:bg-[#444842] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={save}
                disabled={
                  saving ||
                  changedKeys.length === 0 ||
                  limitProblems.length > 0
                }
                className="px-5 py-2 bg-[#51604f] text-white font-semibold rounded-lg text-sm hover:bg-[#6a7967] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>

          {/* ── Per-plan provenance ───────────────────────────────── */}
          <div className="bg-[#2a2c2c] border border-[#444842] rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              Plan history
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {plans.map((plan) => (
                <div key={plan.key}>
                  <h3 className="text-sm font-medium text-[#8fbf8a] uppercase tracking-wider mb-2">
                    {plan.name}
                  </h3>
                  <p className="text-xs text-[#5e5e5b]">
                    {plan.configured
                      ? `Version ${plan.version} · saved ${
                          plan.updatedAt
                            ? new Date(plan.updatedAt).toLocaleString()
                            : "—"
                        }${plan.updatedBy ? ` by ${plan.updatedBy}` : ""}`
                      : "Never configured — the catalogue defaults apply."}
                  </p>
                  {plan.note && (
                    <p className="text-xs text-[#e1dfdb] mt-2 italic">
                      &ldquo;{plan.note}&rdquo;
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
