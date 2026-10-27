"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/apiClient";

export default function SuperAdminLogin() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // The superadmin endpoints live under /api/superadmin, not /admin
      const { data } = await apiClient.post("/superadmin/login", {
        email,
        password,
      });

      if (data.token) {
        // Set cookie via document.cookie for client-side persistence
        // Note: This is a plain cookie (not httpOnly) so the layout can read it
        document.cookie = `superadmin_token=${data.token}; path=/; max-age=86400; SameSite=Strict`;
        router.push("/admin");
      }
    } catch (err: any) {
      setError(
        err.response?.data?.message || "Invalid super admin credentials."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1b1c1c] flex flex-col justify-center items-center p-4 selection:bg-[#51604f] selection:text-white">
      <div className="w-full        max-w-admin bg-[#2a2c2c] p-8 sm:p-10 rounded-[24px] shadow-2xl border border-[#444842]">
        <div className="mb-8 text-center">
          <div className="w-12 h-12 rounded-full bg-[#51604f] flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-white">shield_person</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Platform Control</h1>
          <p className="mt-2 text-[#e1dfdb]">QRDine Super Admin</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-[#ba1a1a]/20 border border-[#ba1a1a]/50 rounded-xl flex items-start gap-3">
            <span className="material-symbols-outlined text-[#ff8989]">error</span>
            <p className="text-sm text-[#ff8989]">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm text-[#e1dfdb] mb-1.5 font-medium">Platform Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@qrdine.com"
              className="w-full px-4 py-3 rounded-xl bg-[#1b1c1c] border border-[#444842] focus:outline-none focus:border-[#51604f] focus:ring-1 focus:ring-[#51604f] transition-all text-white placeholder-[#5e5e5b]"
            />
          </div>

          <div>
            <label className="block text-sm text-[#e1dfdb] mb-1.5 font-medium">Secure Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl bg-[#1b1c1c] border border-[#444842] focus:outline-none focus:border-[#51604f] focus:ring-1 focus:ring-[#51604f] transition-all text-white placeholder-[#5e5e5b]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#51604f] text-white font-semibold rounded-xl py-3 hover:bg-[#6a7967] transition-all flex items-center justify-center gap-2 mt-4 disabled:opacity-70 disabled:pointer-events-none"
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined animate-spin">progress_activity</span>
                Authenticating...
              </>
            ) : (
              "Sign In to Control Plane"
            )}
          </button>
        </form>

        <div className="mt-8 text-center border-t border-[#444842] pt-6">
          <Link href="/" className="text-sm text-[#5e5e5b] hover:text-white transition-colors">
            &larr; Return to public site
          </Link>
        </div>
      </div>
    </div>
  );
}
