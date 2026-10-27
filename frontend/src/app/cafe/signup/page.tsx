"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/apiClient";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    ownerName: "",
    ownerEmail: "",
    password: "",
    cafeName: "",
    cafePhone: "",
    cafeAddress: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload = {
        ownerName: formData.ownerName,
        ownerEmail: formData.ownerEmail,
        password: formData.password,
        cafe: {
          name: formData.cafeName,
          phone: formData.cafePhone,
          address: formData.cafeAddress,
        },
      };

      const { data } = await apiClient.post("/auth/register-owner", payload);

      if (data.token) {
        // Store the token (cookie approach or localStorage fallback)
        // Note: Production usually prefers httpOnly cookies for security, but we set it here for immediate client use
        document.cookie = `admin_token=${data.token}; path=/; max-age=86400; SameSite=Strict`;
        router.push("/cafe/orders");
      }
    } catch (err: any) {
      setError(
        err.response?.data?.message ||
          "An error occurred during registration. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fcf9f8] flex flex-col justify-center items-center p-4 selection:bg-[#51604f] selection:text-white">
      <div className="mb-8 text-center">
        <Link href="/" className="inline-flex items-center gap-2 group">
          <div className="w-10 h-10 rounded-full bg-[#51604f] flex items-center justify-center group-hover:scale-105 transition-transform">
            <span className="text-white font-semibold font-serif italic text-xl leading-none">
              Q
            </span>
          </div>
          <span className="font-semibold text-2xl tracking-tight text-[#1b1c1c]">
            QRDine
          </span>
        </Link>
        <p className="mt-3 text-[#444842]">Set up your cafe in minutes.</p>
      </div>

      <div className="w-full        max-w-signup bg-white p-8 sm:p-10 rounded-[24px] border border-[#e4e2e1] shadow-[0_12px_32px_rgba(0,0,0,0.04)]">
        <h1 className="text-2xl font-semibold text-[#1b1c1c] mb-6">
          Create your account
        </h1>

        {error && (
          <div className="mb-6 p-4 bg-[#ba1a1a]/10 border border-[#ba1a1a]/20 rounded-xl flex items-start gap-3">
            <span className="material-symbols-outlined text-[#ba1a1a]">
              error
            </span>
            <p className="text-sm text-[#ba1a1a]">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Cafe Details Section */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-[#51604f] uppercase tracking-wider">
              Cafe Details
            </h2>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm text-[#444842] mb-1.5 font-medium">
                  Cafe Name *
                </label>
                <input
                  type="text"
                  name="cafeName"
                  required
                  value={formData.cafeName}
                  onChange={handleChange}
                  placeholder="e.g. Central Perk"
                  className="w-full px-4 py-3 rounded-xl bg-[#fcf9f8] border border-[#e4e2e1] focus:outline-none focus:border-[#51604f] focus:ring-1 focus:ring-[#51604f] transition-all text-[#1b1c1c] placeholder-[#e4e2e1]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-[#444842] mb-1.5 font-medium">
                    Contact Phone
                  </label>
                  <input
                    type="tel"
                    name="cafePhone"
                    value={formData.cafePhone}
                    onChange={handleChange}
                    placeholder="+1 234 567 890"
                    className="w-full px-4 py-3 rounded-xl bg-[#fcf9f8] border border-[#e4e2e1] focus:outline-none focus:border-[#51604f] focus:ring-1 focus:ring-[#51604f] transition-all text-[#1b1c1c] placeholder-[#e4e2e1]"
                  />
                </div>
                <div>
                  <label className="block text-sm text-[#444842] mb-1.5 font-medium">
                    Address
                  </label>
                  <input
                    type="text"
                    name="cafeAddress"
                    value={formData.cafeAddress}
                    onChange={handleChange}
                    placeholder="123 Coffee St"
                    className="w-full px-4 py-3 rounded-xl bg-[#fcf9f8] border border-[#e4e2e1] focus:outline-none focus:border-[#51604f] focus:ring-1 focus:ring-[#51604f] transition-all text-[#1b1c1c] placeholder-[#e4e2e1]"
                  />
                </div>
              </div>
            </div>
          </div>

          <hr className="border-[#f0eded]" />

          {/* Owner Details Section */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-[#51604f] uppercase tracking-wider">
              Admin Account
            </h2>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm text-[#444842] mb-1.5 font-medium">
                  Your Name *
                </label>
                <input
                  type="text"
                  name="ownerName"
                  required
                  value={formData.ownerName}
                  onChange={handleChange}
                  placeholder="Gunther"
                  className="w-full px-4 py-3 rounded-xl bg-[#fcf9f8] border border-[#e4e2e1] focus:outline-none focus:border-[#51604f] focus:ring-1 focus:ring-[#51604f] transition-all text-[#1b1c1c] placeholder-[#e4e2e1]"
                />
              </div>
              <div>
                <label className="block text-sm text-[#444842] mb-1.5 font-medium">
                  Email Address *
                </label>
                <input
                  type="email"
                  name="ownerEmail"
                  required
                  value={formData.ownerEmail}
                  onChange={handleChange}
                  placeholder="gunther@centralperk.com"
                  className="w-full px-4 py-3 rounded-xl bg-[#fcf9f8] border border-[#e4e2e1] focus:outline-none focus:border-[#51604f] focus:ring-1 focus:ring-[#51604f] transition-all text-[#1b1c1c] placeholder-[#e4e2e1]"
                />
              </div>
              <div>
                <label className="block text-sm text-[#444842] mb-1.5 font-medium">
                  Password *
                </label>
                <input
                  type="password"
                  name="password"
                  required
                  minLength={6}
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 rounded-xl bg-[#fcf9f8] border border-[#e4e2e1] focus:outline-none focus:border-[#51604f] focus:ring-1 focus:ring-[#51604f] transition-all text-[#1b1c1c] placeholder-[#e4e2e1]"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#51604f] text-white font-semibold rounded-xl py-4 hover:bg-[#6a7967] hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:pointer-events-none mt-2"
          >
            {loading ? (
              <>
                <span className="material-symbols-outlined animate-spin">
                  progress_activity
                </span>
                Creating account...
              </>
            ) : (
              "Start 14-day Free Trial"
            )}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-[#444842]">
          Already have an account?{" "}
          <Link
            href="/cafe/login"
            className="text-[#51604f] font-semibold hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
