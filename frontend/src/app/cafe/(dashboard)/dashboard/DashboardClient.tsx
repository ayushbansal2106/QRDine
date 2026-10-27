"use client";

import React from "react";
import Link from "next/link";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { formatCurrency } from "@/utils/currency";
import type { DashboardData } from "@/actions/dashboard";

interface DashboardClientProps {
  data: DashboardData;
  /**
   * Pre-formatted on the server. Computing it in the client with
   * `new Date().toLocaleDateString(undefined, ...)` produced different text on
   * the server and the browser whenever their locales disagreed, which React
   * reported as a hydration mismatch.
   */
  todayLabel: string;
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-info-container text-on-info-container",
  bill_requested: "bg-warning-container text-on-warning-container",
  awaiting_payment: "bg-warning-container text-on-warning-container",
  paid: "bg-success-container text-on-success-container",
  closed: "bg-surface-container text-on-surface-variant",
};

export const DashboardClient: React.FC<DashboardClientProps> = ({ data, todayLabel }) => {
  const { cafe, telemetry, setup, billing, settlement, review, unavailable } = data;
  const setupPercent = setup.total ? Math.round((setup.completed / setup.total) * 100) : 0;
  const awaitingPayment = billing.rows.filter((b) => b.status === "awaiting_payment").length;

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      <TopAppBar title="Executive Dashboard" iconName="space_dashboard" />

      <main className="flex-1 p-margin-desktop overflow-y-auto">
        <div className="max-w-[1280px] mx-auto flex flex-col gap-lg">

          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-md">
            <div>
              <h2 className="font-semibold text-headline-lg text-on-surface">
                {cafe?.name ? `${cafe.name}` : "Your café"}
              </h2>
              <p className="text-body-md text-on-surface-variant mt-xs">
                {cafe?.address || "Live service overview, revenue and setup health."}
              </p>
            </div>
            <span className="text-body-sm text-on-surface-variant">{todayLabel}</span>
          </div>

          {/* Partial-data notice — one 403 must not blank the whole dashboard. */}
          {unavailable.length > 0 && (
            <div
              role="status"
              className="flex items-start gap-sm rounded-lg border border-surface-container bg-surface-container-low px-md py-sm text-body-sm text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-[18px]">info</span>
              <span>
                Some sections are unavailable for your role:{" "}
                <span className="font-semibold">{unavailable.join(", ")}</span>.
              </span>
            </div>
          )}

          {/* ── Revenue centre ─────────────────────────────────── */}
          <section className="flex flex-col gap-md">
            <SectionHeading title="Revenue centre" icon="trending_up" />

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-gutter">
              <MetricTile
                label="Revenue today"
                value={telemetry ? formatCurrency(telemetry.grossRevenue) : "—"}
                icon="payments"
                tone="primary"
              />
              <MetricTile
                label="Paid orders"
                value={telemetry ? String(telemetry.paidOrderCount) : "—"}
                icon="receipt_long"
                tone="neutral"
              />
              <MetricTile
                label="Active tickets"
                value={telemetry ? String(telemetry.activeTickets) : "—"}
                icon="pending_actions"
                tone={telemetry && telemetry.activeTickets > 0 ? "warning" : "neutral"}
              />
              <MetricTile
                label="Avg fulfilment"
                value={telemetry ? `${telemetry.avgFulfillmentMinutes} min` : "—"}
                icon="timer"
                tone="neutral"
              />
            </div>

            {/* Channel + status breakdown */}
            {telemetry && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
                <Panel title="Orders by channel" icon="hub">
                  {Object.keys(telemetry.channelCounts).length === 0 ? (
                    <EmptyState text="No orders recorded yet today." />
                  ) : (
                    <ul className="flex flex-col gap-sm">
                      {Object.entries(telemetry.channelCounts).map(([channel, count]) => (
                        <BreakdownRow
                          key={channel}
                          label={channel.toUpperCase()}
                          value={count}
                          max={Math.max(...Object.values(telemetry.channelCounts), 1)}
                        />
                      ))}
                    </ul>
                  )}
                </Panel>

                <Panel title="Orders by status" icon="donut_large">
                  {Object.keys(telemetry.statusCounts).length === 0 ? (
                    <EmptyState text="No order activity yet." />
                  ) : (
                    <ul className="flex flex-col gap-sm">
                      {Object.entries(telemetry.statusCounts).map(([status, count]) => (
                        <BreakdownRow
                          key={status}
                          label={status}
                          value={count}
                          max={Math.max(...Object.values(telemetry.statusCounts), 1)}
                        />
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
            )}
          </section>

          {/* ── Setup progress ─────────────────────────────────── */}
          <section className="flex flex-col gap-md">
            <SectionHeading title="Setup progress" icon="rocket_launch" />

            <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md shadow-[0px_2px_8px_rgba(0,0,0,0.02)]">
              <div className="flex items-center justify-between gap-md mb-sm">
                <div>
                  <p className="font-semibold text-headline-md text-on-surface">
                    {setup.completed} of {setup.total} complete
                  </p>
                  <p className="text-body-sm text-on-surface-variant mt-xs">
                    {setupPercent === 100
                      ? "Your café is fully configured and ready for service."
                      : "Finish these steps before taking live orders."}
                  </p>
                </div>
                <span className="font-bold text-title-lg text-primary leading-none">
                  {setupPercent}%
                </span>
              </div>

              <div
                className="w-full h-2 rounded-full bg-surface-container overflow-hidden"
                role="progressbar"
                aria-valuenow={setupPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${setupPercent}%` }}
                />
              </div>

              <ul className="grid grid-cols-1 md:grid-cols-2 gap-sm mt-md">
                {setup.checks.map((check) => (
                  <li key={check.key}>
                    <Link
                      href={check.href}
                      className="flex items-start gap-sm p-sm rounded-lg border border-surface-container hover:bg-surface-container-low transition-colors"
                    >
                      <span
                        className={`material-symbols-outlined text-[20px] mt-px ${
                          check.done ? "text-success" : "text-on-surface-variant/40"
                        }`}
                      >
                        {check.done ? "check_circle" : "radio_button_unchecked"}
                      </span>
                      <span className="flex flex-col">
                        <span
                          className={`text-body-md font-semibold ${
                            check.done ? "text-on-surface" : "text-on-surface-variant"
                          }`}
                        >
                          {check.label}
                        </span>
                        <span className="text-body-sm text-on-surface-variant">
                          {check.detail}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ── Billing centre ─────────────────────────────────── */}
          <section className="flex flex-col gap-md">
            <SectionHeading title="Billing centre" icon="account_balance_wallet" />

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-gutter">
              <MetricTile
                label="Open bills"
                value={billing.available ? String(billing.rows.length) : "—"}
                icon="receipt_long"
                tone="neutral"
              />
              <MetricTile
                label="Awaiting payment"
                value={billing.available ? String(awaitingPayment) : "—"}
                icon="hourglass_top"
                tone={awaitingPayment > 0 ? "warning" : "neutral"}
              />
              <MetricTile
                label="Settled today"
                value={settlement ? formatCurrency(settlement.totalRevenue) : "—"}
                icon="task_alt"
                tone="success"
              />
              <MetricTile
                label="GST collected"
                value={settlement ? formatCurrency(settlement.totalGST) : "—"}
                icon="receipt"
                tone="neutral"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
              <Panel title="Recent bills" icon="list_alt">
                {!billing.available ? (
                  <EmptyState text="Billing is unavailable for your role." />
                ) : billing.rows.length === 0 ? (
                  <EmptyState text="No open bills. Bills appear when guests start ordering." />
                ) : (
                  <ul className="flex flex-col divide-y divide-surface-container">
                    {billing.rows.map((bill) => (
                      <li key={bill.id} className="flex items-center justify-between gap-sm py-sm">
                        <div className="min-w-0">
                          <p className="text-body-md font-semibold text-on-surface truncate">
                            {bill.customerName}
                            {bill.tableNumber !== "—" ? ` · Table ${bill.tableNumber}` : ""}
                          </p>
                          <p className="text-body-sm text-on-surface-variant">
                            {bill.orderCount} order{bill.orderCount === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="flex items-center gap-sm shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              STATUS_TONE[bill.status] || "bg-surface-container text-on-surface-variant"
                            }`}
                          >
                            {bill.status.replace(/_/g, " ")}
                          </span>
                          <span className="text-body-md font-bold text-on-surface">
                            {formatCurrency(bill.total)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Today's settlement" icon="donut_large">
                {!settlement || settlement.byMethod.length === 0 ? (
                  <EmptyState text="No settled bills today yet." />
                ) : (
                  <ul className="flex flex-col gap-sm">
                    {settlement.byMethod.map((m) => (
                      <li
                        key={m.method}
                        className="flex items-center justify-between gap-sm text-body-md"
                      >
                        <span className="text-on-surface-variant capitalize">
                          {m.method.replace(/_/g, " ")}
                          <span className="text-on-surface-variant/60"> · {m.count} bills</span>
                        </span>
                        <span className="font-semibold text-on-surface">
                          {formatCurrency(m.revenue)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </section>

          {/* ── Service pulse ──────────────────────────────────── */}
          <section className="flex flex-col gap-md">
            <SectionHeading title="Service pulse" icon="monitor_heart" />

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-gutter">
              <MetricTile
                label="Tables occupied"
                value={telemetry ? String(telemetry.customerInflux) : "—"}
                icon="table_restaurant"
                tone="neutral"
              />
              <MetricTile
                label="Guest rating"
                value={review ? (review.averageRating ? `${review.averageRating}/5` : "—") : "—"}
                icon="star"
                tone="neutral"
              />
              <MetricTile
                label="Reviews received"
                value={review ? String(review.total) : "—"}
                icon="rate_review"
                tone="neutral"
              />
              <MetricTile
                label="Needs reply"
                value={review ? String(review.pendingAction) : "—"}
                icon="mark_chat_unread"
                tone={review && review.pendingAction > 0 ? "warning" : "neutral"}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

// ── Presentational pieces ────────────────────────────────────────

const SectionHeading: React.FC<{ title: string; icon: string }> = ({ title, icon }) => (
  <div className="flex items-center gap-sm">
    <span className="material-symbols-outlined text-[20px] text-primary">{icon}</span>
    <h3 className="font-semibold text-headline-md text-on-surface">{title}</h3>
  </div>
);

const Panel: React.FC<{ title: string; icon: string; children: React.ReactNode }> = ({
  title,
  icon,
  children,
}) => (
  <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md shadow-[0px_2px_8px_rgba(0,0,0,0.02)]">
    <div className="flex items-center gap-xs mb-sm">
      <span className="material-symbols-outlined text-[18px] text-on-surface-variant">{icon}</span>
      <h4 className="font-semibold text-body-lg text-on-surface">{title}</h4>
    </div>
    {children}
  </div>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-body-sm text-on-surface-variant/70 py-md text-center">{text}</p>
);

type TileTone = "primary" | "success" | "warning" | "neutral";

const TONE_STYLES: Record<TileTone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success-container text-success",
  warning: "bg-warning-container text-warning",
  neutral: "bg-surface-container text-on-surface-variant",
};

const MetricTile: React.FC<{
  label: string;
  value: string;
  icon: string;
  tone: TileTone;
}> = ({ label, value, icon, tone }) => (
  <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md flex items-center gap-md shadow-[0px_2px_8px_rgba(0,0,0,0.02)]">
    <div
      className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${TONE_STYLES[tone]}`}
    >
      <span className="material-symbols-outlined text-[24px]">{icon}</span>
    </div>
    <div className="min-w-0">
      <p className="text-body-sm text-on-surface-variant font-medium uppercase tracking-wider text-[11px]">
        {label}
      </p>
      <p className="text-title-lg font-bold text-on-surface mt-xs leading-none truncate">{value}</p>
    </div>
  </div>
);

const BreakdownRow: React.FC<{ label: string; value: number; max: number }> = ({
  label,
  value,
  max,
}) => {
  const pct = Math.max(value > 0 ? 8 : 0, Math.round((value / max) * 100));
  return (
    <li className="flex flex-col gap-xs">
      <div className="flex items-center justify-between text-body-sm">
        <span className="capitalize text-on-surface-variant">{label}</span>
        <span className="font-semibold text-on-surface">{value}</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </li>
  );
};