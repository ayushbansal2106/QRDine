"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listStaff,
  createStaff,
  updateStaff,
  resetStaffPassword,
  unlockStaff,
  type StaffMember,
  type StaffListResult,
} from "@/actions/superadminStaff";

interface Notice {
  tone: "ok" | "error";
  text: string;
}

const ROLE_TONE: Record<string, string> = {
  superadmin: "bg-[#51604f]/20 text-[#8fbf8a]",
  support: "bg-blue-500/20 text-blue-400",
  readonly: "bg-[#444842]/50 text-[#e1dfdb]",
};

const ROLE_HELP: Record<string, string> = {
  superadmin: "Full control, including terminating tenants and managing staff.",
  support: "Can change plans and extend trials, but cannot terminate a tenant.",
  readonly: "Read-only access for audits and investigations.",
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Never";

const isLocked = (member: StaffMember) =>
  Boolean(member.lockedUntil) && new Date(member.lockedUntil as string) > new Date();

export default function SuperAdminStaff() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<string[]>(["superadmin", "support", "readonly"]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Add-operator form
  const [form, setForm] = useState({ email: "", name: "", role: "support", password: "" });

  const applyResult = useCallback((result: StaffListResult) => {
    if (result.success) {
      setStaff(result.staff);
      if (result.roles.length) setRoles(result.roles);
      setCurrentUserId(result.currentUserId);
    } else {
      setNotice({ tone: "error", text: result.message || "Failed to load staff." });
    }
    setLoading(false);
  }, []);

  /** Used by event handlers and after a mutation. */
  const load = useCallback(async () => {
    applyResult(await listStaff());
  }, [applyResult]);

  // Initial load. State is updated from the promise callback rather than
  // synchronously in the effect body, so there is no cascading render — the
  // shape react-hooks/set-state-in-effect asks for.
  useEffect(() => {
    let cancelled = false;
    listStaff().then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyResult]);

  const refresh = () => {
    setLoading(true);
    void load();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("create");
    const result = await createStaff(form);
    setNotice({ tone: result.success ? "ok" : "error", text: result.message });
    if (result.success) {
      setForm({ email: "", name: "", role: "support", password: "" });
      await load();
    }
    setBusy(null);
  };

  const handleRoleChange = async (member: StaffMember, role: string) => {
    setBusy(member.id);
    const result = await updateStaff(member.id, { role });
    setNotice({ tone: result.success ? "ok" : "error", text: result.message });
    await load();
    setBusy(null);
  };

  const handleToggleActive = async (member: StaffMember) => {
    const nextActive = !member.isActive;
    if (
      !window.confirm(
        nextActive
          ? `Reactivate ${member.email}? They regain access to the control plane.`
          : `Deactivate ${member.email}? Their open sessions stop working on the next request.`
      )
    ) {
      return;
    }

    setBusy(member.id);
    const result = await updateStaff(member.id, { isActive: nextActive });
    setNotice({ tone: result.success ? "ok" : "error", text: result.message });
    await load();
    setBusy(null);
  };

  const handleResetPassword = async (member: StaffMember) => {
    const password = window.prompt(
      `New password for ${member.email} (min 12 characters). It is not shown again.`
    );
    if (password === null) return;
    if (password.length < 12) {
      setNotice({ tone: "error", text: "Password must be at least 12 characters." });
      return;
    }

    setBusy(member.id);
    const result = await resetStaffPassword(member.id, password);
    setNotice({ tone: result.success ? "ok" : "error", text: result.message });
    await load();
    setBusy(null);
  };

  const handleUnlock = async (member: StaffMember) => {
    setBusy(member.id);
    const result = await unlockStaff(member.id);
    setNotice({ tone: result.success ? "ok" : "error", text: result.message });
    await load();
    setBusy(null);
  };

  return (
    <div className="max-w-6xl">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Platform Staff</h1>
          <p className="text-[#e1dfdb]">
            QRDine operators who can access this control plane.
          </p>
        </div>
        <button
          onClick={refresh}
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

      {/* ── Add operator ───────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Add an operator</h2>
        <form
          onSubmit={handleCreate}
          className="bg-[#2a2c2c] border border-[#444842] rounded-2xl p-6 grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[#e1dfdb] uppercase tracking-wider">
              Email
            </span>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="ops@qrdine.com"
              className="bg-[#1b1c1c] border border-[#444842] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#51604f]"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[#e1dfdb] uppercase tracking-wider">
              Name
            </span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Asha"
              className="bg-[#1b1c1c] border border-[#444842] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#51604f]"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[#e1dfdb] uppercase tracking-wider">
              Role
            </span>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="bg-[#1b1c1c] border border-[#444842] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#51604f]"
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-[#5e5e5b]">{ROLE_HELP[form.role] || ""}</span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[#e1dfdb] uppercase tracking-wider">
              Password
            </span>
            <input
              type="password"
              required
              minLength={12}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 12 characters"
              className="bg-[#1b1c1c] border border-[#444842] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#51604f]"
            />
            <span className="text-[11px] text-[#5e5e5b]">
              Shown once — store it before you navigate away.
            </span>
          </label>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={busy === "create"}
              className="px-5 py-2.5 bg-[#51604f] text-white font-semibold rounded-lg hover:bg-[#6a7967] transition-colors disabled:opacity-50"
            >
              {busy === "create" ? "Creating…" : "Create operator"}
            </button>
          </div>
        </form>
      </section>

      {/* ── Roster ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Operators</h2>
        <div className="bg-[#2a2c2c] border border-[#444842] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#444842] bg-[#1b1c1c]/50">
                  <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Operator</th>
                  <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Role</th>
                  <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Status</th>
                  <th className="p-4 text-sm font-semibold text-[#e1dfdb]">Last sign-in</th>
                  <th className="p-4 text-sm font-semibold text-[#e1dfdb] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#444842]">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-[#e1dfdb]">
                      <span className="material-symbols-outlined animate-spin text-2xl">
                        progress_activity
                      </span>
                    </td>
                  </tr>
                ) : staff.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-[#e1dfdb]">
                      No staff accounts found.
                    </td>
                  </tr>
                ) : (
                  staff.map((member) => {
                    const self = member.id === currentUserId;
                    const locked = isLocked(member);
                    return (
                      <tr key={member.id} className="hover:bg-[#444842]/20 transition-colors">
                        <td className="p-4">
                          <p className="font-semibold text-white">
                            {member.name || member.email}
                            {self && (
                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#8fbf8a]">
                                you
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-[#5e5e5b]">{member.email}</p>
                        </td>

                        <td className="p-4">
                          <select
                            value={member.role}
                            disabled={self || busy === member.id}
                            title={
                              self
                                ? "You cannot change your own role."
                                : "Change this operator's role"
                            }
                            onChange={(e) => handleRoleChange(member, e.target.value)}
                            className="bg-[#1b1c1c] border border-[#444842] rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#51604f] disabled:opacity-50"
                          >
                            {roles.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                          <div className="mt-1">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                                ROLE_TONE[member.role] || "bg-[#444842]/50 text-[#e1dfdb]"
                              }`}
                            >
                              {member.role}
                            </span>
                          </div>
                        </td>

                        <td className="p-4">
                          {!member.isActive ? (
                            <span className="px-2 py-1 rounded-md bg-[#ba1a1a]/20 text-[#ff8989] text-[10px] font-bold uppercase tracking-wider">
                              Deactivated
                            </span>
                          ) : locked ? (
                            <span className="px-2 py-1 rounded-md bg-amber-500/20 text-amber-400 text-[10px] font-bold uppercase tracking-wider">
                              Locked
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-md bg-[#51604f]/20 text-[#8fbf8a] text-[10px] font-bold uppercase tracking-wider">
                              Active
                            </span>
                          )}
                        </td>

                        <td className="p-4 text-sm text-[#e1dfdb]">
                          {formatDate(member.lastLoginAt)}
                        </td>

                        <td className="p-4">
                          <div className="flex items-center justify-end gap-2">
                            {locked && (
                              <button
                                disabled={busy === member.id}
                                onClick={() => handleUnlock(member)}
                                className="px-3 py-1.5 bg-amber-500/20 text-amber-400 rounded-lg text-xs font-semibold hover:bg-amber-500/40 transition-colors disabled:opacity-50"
                              >
                                Unlock
                              </button>
                            )}
                            <button
                              disabled={busy === member.id}
                              onClick={() => handleResetPassword(member)}
                              className="px-3 py-1.5 bg-[#444842]/50 text-[#e1dfdb] rounded-lg text-xs font-semibold hover:bg-[#444842] transition-colors disabled:opacity-50"
                            >
                              Reset password
                            </button>
                            <button
                              disabled={self || busy === member.id}
                              title={self ? "You cannot deactivate your own account." : undefined}
                              onClick={() => handleToggleActive(member)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                                member.isActive
                                  ? "bg-[#ba1a1a]/20 text-[#ff8989] hover:bg-[#ba1a1a]/40"
                                  : "bg-[#51604f]/20 text-[#8fbf8a] hover:bg-[#51604f]/40"
                              }`}
                            >
                              {member.isActive ? "Deactivate" : "Activate"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-[#5e5e5b] mt-4">
          Deactivation takes effect immediately — the server re-checks each account on every
          request, so open sessions stop working without waiting for the token to expire.
        </p>
      </section>
    </div>
  );
}
