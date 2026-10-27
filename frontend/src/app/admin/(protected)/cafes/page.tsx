"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listCafes,
  terminateCafe,
  reinstateCafe,
  type SuperAdminCafe,
} from "@/actions/superadmin";

export default function SuperAdminCafes() {
  const [cafes, setCafes] = useState<SuperAdminCafe[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const fetchCafes = useCallback(async () => {
    setLoading(true);
    const result = await listCafes();
    if (result.success) {
      setCafes(result.cafes);
    } else {
      setNotice({ tone: "error", text: result.message || "Failed to load tenants." });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCafes();
  }, [fetchCafes]);

  const handleTerminate = async (cafeId: string) => {
    const reason = window.prompt("Enter a reason for termination (min 5 chars):");
    if (!reason || reason.trim().length < 5) {
      setNotice({ tone: "error", text: "Termination requires a valid reason (min 5 chars)." });
      return;
    }

    if (
      !window.confirm(
        "Are you sure you want to terminate this tenant? They will immediately lose access."
      )
    ) {
      return;
    }

    setActionLoading(cafeId);
    // Server Action: CSRF is validated server-side. A client-side call could
    // never satisfy the double-submit check (see actions/superadmin.ts).
    const result = await terminateCafe(cafeId, reason);
    setNotice({ tone: result.success ? "ok" : "error", text: result.message });
    await fetchCafes();
    setActionLoading(null);
  };

  const handleReinstate = async (cafeId: string) => {
    if (!window.confirm("Are you sure you want to reinstate this tenant?")) return;

    setActionLoading(cafeId);
    const result = await reinstateCafe(cafeId);
    setNotice({ tone: result.success ? "ok" : "error", text: result.message });
    await fetchCafes();
    setActionLoading(null);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <span className="px-2 py-1 rounded-md bg-[#51604f]/20 text-[#51604f] text-xs font-semibold uppercase tracking-wider">Active</span>;
      case "trialing":
        return <span className="px-2 py-1 rounded-md bg-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider">Trial</span>;
      case "terminated":
        return <span className="px-2 py-1 rounded-md bg-[#ba1a1a]/20 text-[#ff8989] text-xs font-semibold uppercase tracking-wider">Terminated</span>;
      default:
        return <span className="px-2 py-1 rounded-md bg-[#444842]/50 text-[#e1dfdb] text-xs font-semibold uppercase tracking-wider">{status}</span>;
    }
  };

  return (
    <div className="max-w-6xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Tenants (Cafes)</h1>
          <p className="text-[#e1dfdb]">Manage all registered cafe accounts on the platform.</p>
        </div>
        <button onClick={fetchCafes} className="p-2 bg-[#2a2c2c] border border-[#444842] rounded-lg hover:bg-[#444842] transition-colors">
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

      <div className="bg-[#2a2c2c] border border-[#444842] rounded-2xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#444842] bg-[#1b1c1c]/50">
                <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Cafe Details</th>
                <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Contact</th>
                <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Plan & Status</th>
                <th className="p-4 text-sm font-semibold text-[#e1dfdb] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#444842]">
              {loading ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-[#e1dfdb]">
                    <span className="material-symbols-outlined animate-spin text-2xl">progress_activity</span>
                  </td>
                </tr>
              ) : cafes.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-[#e1dfdb]">No cafes found.</td>
                </tr>
              ) : (
                cafes.map((cafe) => (
                  <tr key={cafe.cafeId} className="hover:bg-[#444842]/20 transition-colors">
                    <td className="p-4">
                      <p className="font-semibold text-white">{cafe.name}</p>
                      <p className="text-sm text-[#5e5e5b]">ID: {cafe.cafeId.substring(0, 8)}...</p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm text-[#e1dfdb]">{cafe.email}</p>
                      <p className="text-sm text-[#5e5e5b]">{cafe.phone || "No phone"}</p>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusBadge(cafe.status)}
                        <span className="text-sm text-[#e1dfdb] capitalize">{cafe.planKey || "Free"}</span>
                      </div>
                      <p className="text-xs text-[#5e5e5b]">
                        {cafe.paidUntil ? `Paid until ${new Date(cafe.paidUntil).toLocaleDateString()}` : "No billing history"}
                      </p>
                    </td>
                    <td className="p-4 text-right">
                      {cafe.status === "terminated" ? (
                        <button
                          disabled={actionLoading === cafe.cafeId}
                          onClick={() => handleReinstate(cafe.cafeId)}
                          className="px-4 py-2 bg-[#51604f]/20 text-[#51604f] rounded-lg text-sm font-semibold hover:bg-[#51604f]/40 transition-colors disabled:opacity-50"
                        >
                          Reinstate
                        </button>
                      ) : (
                        <button
                          disabled={actionLoading === cafe.cafeId}
                          onClick={() => handleTerminate(cafe.cafeId)}
                          className="px-4 py-2 bg-[#ba1a1a]/20 text-[#ff8989] rounded-lg text-sm font-semibold hover:bg-[#ba1a1a]/40 transition-colors disabled:opacity-50"
                        >
                          Terminate
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
