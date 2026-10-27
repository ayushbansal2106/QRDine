import React from "react";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Processing Addendum (DPA) | QRDine",
  description: "DPDP Act 2023 Compliance, Data Fiduciary vs Data Processor roles, and CERT-In reporting.",
};

export default function DpaPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-8 sm:p-12">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-6 mb-8">
          <Link
            href="/"
            className="inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-800 transition"
          >
            ← Back to QRDine
          </Link>
          <div className="flex gap-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <Link href="/legal/terms" className="hover:text-slate-600 transition">
              Master Terms
            </Link>
            <span>•</span>
            <span className="text-indigo-600">Data Processing (DPA)</span>
          </div>
        </div>

        {/* Header */}
        <div className="mb-10">
          <div className="inline-block px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full mb-3">
            DPDP Act 2023 & IT Act 2000 • Version 2026.1
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Data Processing Addendum (DPA)
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Standard Contractual Clauses for Data Protection between Restaurant (Data Fiduciary) and QRDine (Data Processor).
          </p>
        </div>

        {/* Role Demarcation Card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">DPDP Role</div>
            <div className="text-lg font-bold text-slate-900 mt-1">Restaurant / Merchant</div>
            <div className="text-xs text-indigo-600 font-semibold mt-0.5">Data Fiduciary (Section 2(i))</div>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Determines the purpose, customer interactions, loyalty programs, and lawful basis for collecting patron data.
            </p>
          </div>
          <div className="p-4 bg-indigo-50/50 border border-indigo-200 rounded-xl">
            <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider">DPDP Role</div>
            <div className="text-lg font-bold text-indigo-950 mt-1">QRDine Platform</div>
            <div className="text-xs text-indigo-600 font-semibold mt-0.5">Data Processor (Section 2(k))</div>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Processes patron data strictly on behalf of and per the documented instructions of the Data Fiduciary.
            </p>
          </div>
        </div>

        {/* Content Body */}
        <div className="space-y-8 text-sm leading-relaxed text-slate-700">
          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-3">1. Scope and Categories of Data Processed</h2>
            <p className="mb-2">
              QRDine processes personal data exclusively for facilitating QR table ordering, kitchen ticket generation,
              automated digital billing, and patron loyalty rewards:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-600">
              <li><strong>Data Principals:</strong> Dining customers, registered patrons, cafe staff, and managers.</li>
              <li><strong>Personal Data Categories:</strong> Mobile phone numbers, patron names, table session tokens, order histories, and payment references.</li>
              <li><strong>Sensitive Personal Data:</strong> No payment card numbers or banking passwords are ever stored or processed by QRDine (handled via PCI-DSS compliant direct gateways).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-3">2. Technical & Organizational Security Measures</h2>
            <div className="space-y-2">
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                <span className="font-semibold text-slate-900">Multi-Tenant Logical Isolation:</span> Every database entity includes an immutable, indexed <code className="bg-slate-200 text-slate-800 px-1 py-0.5 rounded text-xs">cafeId</code>, preventing cross-tenant leakage.
              </div>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                <span className="font-semibold text-slate-900">Encryption Standards:</span> TLS 1.3 encryption in transit for all web traffic; AES-256 encryption at rest for sensitive configurations.
              </div>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg">
                <span className="font-semibold text-slate-900">Ephemeral Dining Sessions:</span> Cryptographically random guest tokens (<code className="bg-slate-200 text-slate-800 px-1 py-0.5 rounded text-xs">x-guest-token</code>) expire automatically upon checkout.
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-3">3. CERT-In 6-Hour Emergency Reporting Protocol</h2>
            <p className="mb-2">
              In strict accordance with the CERT-In Cyber Security Directions (Section 70B(6) IT Act 2000), QRDine maintains
              an automated forensic containment engine:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Immediate Notification:</strong> QRDine will notify the affected Data Fiduciary without undue delay and within 4 hours of confirming a security breach.
              </li>
              <li>
                <strong>CERT-In Annexure-I Dossier:</strong> QRDine generates standardized incident dossiers to enable statutory submission to CERT-In (<code className="text-xs bg-slate-100 px-1 py-0.5 rounded">incident@cert-in.org.in</code>) within the mandatory 6-hour statutory window.
              </li>
              <li>
                <strong>Emergency Tenant Quarantine:</strong> Capability to instantly revoke active guest session tokens and quarantine affected cafe endpoints to stop threat propagation.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-3">4. Data Principal Rights & Data Erasure</h2>
            <p>
              Under Sections 11, 12, and 13 of the DPDP Act 2023, data principals enjoy rights of access, correction,
              and erasure. QRDine provides automated administrative export tools and implements data erasure (Right to be Forgotten)
              within 72 hours of validated requests, subject only to statutory tax retention laws (GST 7-year rule) and CERT-In 180-day log mandates.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-3">5. Data Protection Officer (DPO) Contact</h2>
            <p>
              For privacy inquiries, grievance redressal, or regulatory correspondence:
              <br />
              <strong>Data Protection Office:</strong> <code className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-xs">dpo@qrdine.in</code>
              <br />
              <strong>Emergency Cyber Response:</strong> <code className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-xs">security@qrdine.in</code>
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <p>© 2026 QRDine Technologies India Pvt. Ltd. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/legal/terms" className="hover:text-slate-600 transition">
              Terms of Service
            </Link>
            <Link href="/legal/dpa" className="hover:text-slate-600 transition">
              DPA Agreement
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
