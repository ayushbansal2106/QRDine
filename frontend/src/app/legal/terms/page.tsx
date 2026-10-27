import React from "react";
import Link from "next/link";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Master SaaS Agreement & Terms | QRDine",
  description: "Terms of Service, Section 79 Intermediary Safe Harbor, and Restaurant Responsibilities.",
};

export default function TermsPage() {
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
            <span className="text-indigo-600">Master Terms</span>
            <span>•</span>
            <Link href="/legal/dpa" className="hover:text-slate-600 transition">
              Data Processing (DPA)
            </Link>
          </div>
        </div>

        {/* Header */}
        <div className="mb-10">
          <div className="inline-block px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-full mb-3">
            Legal & Regulatory Specification • Version 2026.1
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Master SaaS Agreement & Terms of Service
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Last updated: October 27, 2026 • Governing Law: Republic of India
          </p>
        </div>

        {/* Executive Callout */}
        <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-xl mb-8">
          <div className="flex">
            <div className="flex-shrink-0">
              <span className="text-amber-600 text-lg">⚖️</span>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-semibold text-amber-800">
                Statutory Intermediary Safe Harbor Notice (Section 79 IT Act 2000)
              </h3>
              <p className="mt-1 text-xs text-amber-700 leading-relaxed">
                QRDine operates purely as a technology software intermediary. Food preparation,
                ingredient sourcing, allergen declarations, table service, and food safety hygiene are
                managed exclusively by each respective restaurant holding a valid FSSAI license.
              </p>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="space-y-8 text-sm leading-relaxed text-slate-700">
          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-3">
              1. Platform Relationship & Statutory Demarcation
            </h2>
            <p className="mb-2">
              This Master SaaS Agreement (&quot;Agreement&quot;) governs the provision and use of the QRDine
              cloud-based software platform by the registered cafe, restaurant, or eatery entity
              (&quot;Restaurant&quot;).
            </p>
            <p>
              Under <strong>Section 79 of the Information Technology Act, 2000</strong>, QRDine
              qualifies as a technology intermediary. QRDine does not initiate customer order
              transmissions, does not select recipients, and does not alter menu data or order content
              submitted by patrons and kitchen staff.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-3">
              2. FSSAI Compliance & Merchant Responsibilities
            </h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Mandatory FSSAI License:</strong> The Restaurant represents and warrants that it
                holds a valid food safety license or registration issued by the Food Safety and
                Standards Authority of India (FSSAI).
              </li>
              <li>
                <strong>Hygiene & Allergen Transparency:</strong> All dish descriptions, dietary tags
                (veg/non-veg), allergens, and nutritional details entered into the platform are the sole
                responsibility of the Restaurant.
              </li>
              <li>
                <strong>Customer Grievances:</strong> The Restaurant must designate a contact
                for patron inquiries regarding food quality, delayed orders, or billing adjustments.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-3">
              3. GST & Subscription Invoicing (SAC 998313)
            </h2>
            <p className="mb-2">
              QRDine SaaS subscription fees are classified under <strong>SAC Code 998313</strong> (Information
              Technology Software services) and are subject to Goods and Services Tax (GST) at 18%:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Intra-State Supply (Delhi to Delhi):</strong> CGST (9%) + SGST (9%).
              </li>
              <li>
                <strong>Inter-State Supply (Delhi to other States/UTs):</strong> IGST (18%).
              </li>
              <li>
                <strong>Tax Invoicing:</strong> Tax invoices are generated electronically conforming to
                Rule 46 of the Central Goods and Services Tax (CGST) Rules.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-3">
              4. Payment Gateways & BYO PG Architecture
            </h2>
            <p>
              For Pro and Growth tier subscribers utilizing Bring-Your-Own Payment Gateway (BYO PG),
              all transaction funds settle directly into the Restaurant&apos;s merchant bank account. QRDine
              never holds, pools, or intermediates merchant sale proceeds, complying with Reserve Bank of
              India (RBI) payment aggregator regulations.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-3">
              5. Data Privacy & CERT-In Compliance
            </h2>
            <p>
              Data processing is conducted strictly in accordance with our{" "}
              <Link href="/legal/dpa" className="text-indigo-600 font-semibold underline">
                Data Processing Addendum (DPA)
              </Link>
              . QRDine enforces Indian sovereign data hosting, rolling 180-day audit log retention, and
              automated incident response matrices conforming to CERT-In cybersecurity directives.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-slate-900 mb-3">
              6. Dispute Resolution & Jurisdiction
            </h2>
            <p>
              This Agreement is governed by the laws of India. Any legal dispute, claim, or controversy
              shall be subject to the exclusive jurisdiction of the competent courts situated in{" "}
              <strong>New Delhi, India</strong>.
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
