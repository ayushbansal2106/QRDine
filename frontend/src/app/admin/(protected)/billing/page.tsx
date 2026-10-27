"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getOverview,
  listCafes,
  listExpiring,
  getPlanCatalogue,
  setCafePlan,
  extendCafeTrial,
  type PlatformOverview,
  type SuperAdminCafe,
  type ExpiringTenant,
  type PlanCatalogueEntry,
} from "@/actions/superadmin";

interface Notice {
  tone: "ok" | "error";
  text: string;
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-[#51604f]/20 text-[#8fbf8a]",
  trialing: "bg-blue-500/20 text-blue-400",
  grace: "bg-amber-500/20 text-amber-400",
  degraded: "bg-orange-500/20 text-orange-400",
  cancelled: "bg-[#444842]/50 text-[#e1dfdb]",
  terminated: "bg-[#ba1a1a]/20 text-[#ff8989]",
};

export default function SuperAdminBilling() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [cafes, setCafes] = useState<SuperAdminCafe[]>([]);
  const [expiring, setExpiring] = useState<ExpiringTenant[]>([]);
  const [plans, setPlans] = useState<PlanCatalogueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Per-row plan editor state, keyed by cafeId.
  const [draft, setDraft] = useState<
    Record<string, { planKey: string; cycle: "monthly" | "annual"; outlets: number }>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    const [ov, cf, ex, pl] = await Promise.all([
      getOverview(),
      listCafes(),
      listExpiring(30),
      getPlanCatalogue(),
    ]);
    if (ov.success) setOverview(ov.overview);
    if (cf.success) setCafes(cf.cafes);
    if (ex.success) setExpiring(ex.tenants);
    if (pl.success) setPlans(pl.plans);
    const failure = [ov, cf, ex, pl].find((r) => !r.success);
    if (failure?.message) setNotice({ tone: "error", text: failure.message });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const draftFor = (cafe: SuperAdminCafe) =>
    draft[cafe.cafeId] || {
      planKey: cafe.planKey || "trial",
      cycle: "monthly" as const,
      outlets: cafe.outlets || 1,
    };

  type Draft = { planKey: string; cycle: "monthly" | "annual"; outlets: number };

  const updateDraft = (cafeId: string, patch: Partial<Draft>) => {
    setDraft((prev) => {
      const existing: Draft =
        prev[cafeId] ?? { planKey: "trial", cycle: "monthly", outlets: 1 };
      return { ...prev, [cafeId]: { ...existing, ...patch } };
    });
  };

  const applyPlan = async (cafe: SuperAdminCafe) => {
    const d = draftFor(cafe);
    setBusy(cafe.cafeId);
    const result = await setCafePlan(cafe.cafeId, d.planKey, d.cycle, Number(d.outlets) || 1);
    setNotice({ tone: result.success ? "ok" : "error", text: result.message });
    await load();
    setBusy(null);
  };

  const extend = async (cafeId: string, days: number) => {
    setBusy(cafeId);
    const result = await extendCafeTrial(cafeId, days);
    setNotice({ tone: result.success ? "ok" : "error", text: result.message });
    await load();
    setBusy(null);
  };

  const STATUS_CARDS: { key: keyof PlatformOverview; label: string }[] = [
    { key: "cafes", label: "Total Tenants" },
    { key: "active", label: "Active" },
    { key: "trialing", label: "Trialing" },
    { key: "grace", label: "In Grace" },
    { key: "degraded", label: "Degraded" },
    { key: "terminated", label: "Terminated" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Subscriptions</h1>
          <p className="text-[#e1dfdb]">Platform revenue, renewals and per-tenant plans.</p>
        </div>
        <button
          onClick={load}
          className="p-2 bg-[#2a2c2c] border border-[#444842] rounded-lg hover:bg-[#444842] transition-colors"
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

      {/* ── Overview tiles ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
        {STATUS_CARDS.map((card) => (
          <div
            key={card.key}
            className="bg-[#2a2c2c] border border-[#444842] rounded-2xl p-5 flex flex-col justify-between"
          >
            <h3 className="text-[11px] font-medium text-[#e1dfdb] uppercase tracking-wider mb-3">
              {card.label}
            </h3>
            <p className="text-3xl font-bold text-white">
              {loading ? "—" : String(overview?.[card.key] ?? 0)}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-[#2a2c2c] border border-[#444842] rounded-2xl p-6 mb-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-[#e1dfdb] uppercase tracking-wider">
            Monthly Recurring Revenue
          </h3>
          <p className="text-[11px] text-[#5e5e5b] mt-1">
            GST-exclusive. Counts only active and grace tenants, so it is the pessimistic figure.
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-white">
            ₹{loading ? "—" : (overview?.mrrRupees ?? 0).toLocaleString("en-IN")}
          </p>
          <p className="text-xs text-[#5e5e5b]">
            {overview?.payingTenants ?? 0} paying tenant
            {(overview?.payingTenants ?? 0) === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {/* ── Renewals ───────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Renewals due (next 30 days)</h2>
        <div className="bg-[#2a2c2c] border border-[#444842] rounded-2xl overflow-hidden">
          {loading ? (
            <p className="p-6 text-[#e1dfdb]">Loading…</p>
          ) : expiring.length === 0 ? (
            <p className="p-6 text-[#5e5e5b]">Nothing lapsing in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-[#444842]">
              {expiring.map((t) => (
                <li key={t.cafeId} className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{t.name}</p>
                    <p className="text-xs text-[#5e5e5b]">
                      {t.planKey || "free"} ·{" "}
                      {t.daysRemaining === null
                        ? "no end date"
                        : `${t.daysRemaining} day${t.daysRemaining === 1 ? "" : "s"} left`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                        STATUS_TONE[t.status] || "bg-[#444842]/50 text-[#e1dfdb]"
                      }`}
                    >
                      {t.status}
                    </span>
                    <button
                      disabled={busy === t.cafeId}
                      onClick={() => extend(t.cafeId, 14)}
                      className="px-3 py-1.5 bg-[#51604f]/20 text-[#8fbf8a] rounded-lg text-xs font-semibold hover:bg-[#51604f]/40 transition-colors disabled:opacity-50"
                    >
                      Extend 14d
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Plan management ────────────────────────────────────── */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Manage plans</h2>
        <div className="bg-[#2a2c2c] border border-[#444842] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#444842] bg-[#1b1c1c]/50">
                  <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Tenant</th>
                  <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Status</th>
                  <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Plan</th>
                  <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Cycle</th>
                  <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Outlets</th>
                  <th className="p-4 text-sm font-semibold text-[#e1dfdb] text-right">Apply</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#444842]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-[#e1dfdb]">
                      <span className="material-symbols-outlined animate-spin text-2xl">
                        progress_activity
                      </span>
                    </td>
                  </tr>
                ) : cafes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-[#e1dfdb]">
                      No tenants found.
                    </td>
                  </tr>
                ) : (
                  cafes.map((cafe) => {
                    const d = draftFor(cafe);
                    return (
                      <tr key={cafe.cafeId} className="hover:bg-[#444842]/20 transition-colors">
                        <td className="p-4">
                          <p className="font-semibold text-white">{cafe.name}</p>
                          <p className="text-xs text-[#5e5e5b]">{cafe.email || "no email"}</p>
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                              STATUS_TONE[cafe.status] || "bg-[#444842]/50 text-[#e1dfdb]"
                            }`}
                          >
                            {cafe.status}
                          </span>
                        </td>
                        <td className="p-4">
                          <select
                            value={d.planKey}
                            onChange={(e) => updateDraft(cafe.cafeId, { planKey: e.target.value })}
                            className="bg-[#1b1c1c] border border-[#444842] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#51604f]"
                          >
                            {(plans.length
                              ? plans
                              : [{ key: "trial", name: "Free Trial", blurb: "" } as PlanCatalogueEntry]
                            ).map((p) => (
                              <option key={p.key} value={p.key}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-4">
                          <select
                            value={d.cycle}
                            onChange={(e) =>
                              updateDraft(cafe.cafeId, {
                                cycle: e.target.value as "monthly" | "annual",
                              })
                            }
                            className="bg-[#1b1c1c] border border-[#444842] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#51604f]"
                          >
                            <option value="monthly">Monthly</option>
                            <option value="annual">Annual</option>
                          </select>
                        </td>
                        <td className="p-4">
                          <input
                            type="number"
                            min={1}
                            value={d.outlets}
                            onChange={(e) =>
                              updateDraft(cafe.cafeId, { outlets: Number(e.target.value) })
                            }
                            className="w-20 bg-[#1b1c1c] border border-[#444842] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#51604f]"
                          />
                        </td>
                        <td className="p-4 text-right">
                          <button
                            disabled={busy === cafe.cafeId}
                            onClick={() => applyPlan(cafe)}
                            className="px-4 py-2 bg-[#51604f]/20 text-[#8fbf8a] rounded-lg text-sm font-semibold hover:bg-[#51604f]/40 transition-colors disabled:opacity-50"
                          >
                            Apply
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
