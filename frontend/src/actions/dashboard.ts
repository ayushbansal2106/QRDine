"use server";

import { apiClient } from "@/lib/apiClient";

/**
 * Data for the café executive dashboard.
 *
 * Every source is fetched with `Promise.allSettled` rather than `Promise.all`:
 * these endpoints have different permission requirements (a cashier may read
 * `/tables` but not `/reviews/summary`), and one 403 must not blank the whole
 * page. Each section reports its own availability instead.
 */

export interface DashboardTelemetry {
  available: boolean;
  grossRevenue: number;
  paidOrderCount: number;
  activeTickets: number;
  customerInflux: number;
  avgFulfillmentMinutes: number;
  statusCounts: Record<string, number>;
  channelCounts: Record<string, number>;
}

export interface SetupCheck {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  href: string;
}

export interface BillingRow {
  id: string;
  sessionId: string;
  tableNumber: string;
  customerName: string;
  status: string;
  orderCount: number;
  total: number;
  createdAt: string;
}

export interface SettlementSummary {
  available: boolean;
  date: string;
  totalBills: number;
  totalRevenue: number;
  totalGST: number;
  /** The API returns this as an array of `{ method, count, revenue }`. */
  byMethod: { method: string; count: number; revenue: number }[];
}

export interface DashboardData {
  cafe: { name: string; address?: string; phone?: string } | null;
  telemetry: DashboardTelemetry | null;
  setup: { checks: SetupCheck[]; completed: number; total: number };
  billing: { available: boolean; rows: BillingRow[] };
  settlement: SettlementSummary | null;
  review: { available: boolean; averageRating: number; total: number; pendingAction: number } | null;
  /** Sources that could not be read, with the reason — surfaced in the UI. */
  unavailable: string[];
}

/**
 * What each dashboard endpoint returns, as far as this file reads it.
 *
 * `settle` previously took `() => Promise<any>` and every call site wrote
 * `settle<any>(...)`, so the nine sections below were completely unchecked: a
 * renamed field or a changed response envelope compiled fine and rendered
 * `undefined`. Declaring the envelopes once, at the boundary, is what makes the
 * reads below type-safe.
 */
interface LiveResponse {
  telemetry?: {
    grossRevenue?: number;
    paidOrderCount?: number;
    activeTickets?: number;
    customerInflux?: number;
    avgFulfillmentMinutes?: number;
    statusCounts?: Record<string, number>;
    channelCounts?: Record<string, number>;
  } | null;
}

interface BillsResponse {
  bills?: RawBill[] | null;
}

type SettlementResponse = Partial<SettlementSummary>;

interface ReviewsResponse {
  available?: boolean;
  summary?: {
    averageRating?: number;
    total?: number;
    pendingActionCount?: number;
  } | null;
}

interface CafeResponse {
  cafe?: { name?: string; address?: string; phone?: string } | null;
}

interface TablesResponse {
  totalCount?: number;
  tables?: unknown[];
}

interface MenuResponse {
  count?: number;
  menuItems?: unknown[];
}

interface CategoriesResponse {
  count?: number;
  categories?: unknown[];
}

interface StaffResponse {
  users?: unknown[];
}

/** A bill row as `/billing/bills` returns it — a session document, spread. */
export interface RawBill {
  _id?: string;
  id?: string;
  /** Populated on some endpoints, denormalised on others. */
  tableId?: { tableNumber?: string } | string | null;
  tableNumber?: string | null;
  customerName?: string | null;
  status?: string | null;
  orderCount?: number;
  runningTotal?: number;
  totalAmount?: number;
  createdAt?: string | null;
  startedAt?: string | null;
}

/** An Axios response carrying an already-declared body. */
type Fetcher<T> = () => Promise<{ data: T }>;

async function settle<T>(
  fetcher: Fetcher<T>,
  label: string,
  unavailable: string[],
  fallback: T
): Promise<T> {
  try {
    const res = await fetcher();
    return res?.data ?? fallback;
  } catch {
    unavailable.push(label);
    return fallback;
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const unavailable: string[] = [];

  const [live, bills, settlement, reviews, cafe, tables, menu, categories, staff] =
    await Promise.all([
      settle<LiveResponse | null>(
        () => apiClient.get<LiveResponse>("/analytics/live"),
        "Live metrics",
        unavailable,
        null
      ),
      settle<BillsResponse | null>(
        () => apiClient.get<BillsResponse>("/billing/bills", { params: { limit: 50 } }),
        "Billing",
        unavailable,
        null
      ),
      settle<SettlementResponse | null>(
        () => apiClient.get<SettlementResponse>("/billing/settlement"),
        "Settlement",
        unavailable,
        null
      ),
      settle<ReviewsResponse | null>(
        () => apiClient.get<ReviewsResponse>("/reviews/summary"),
        "Reviews",
        unavailable,
        null
      ),
      settle<CafeResponse | null>(
        () => apiClient.get<CafeResponse>("/cafe"),
        "Café profile",
        unavailable,
        null
      ),
      settle<TablesResponse | null>(
        () => apiClient.get<TablesResponse>("/tables", { params: { limit: 100 } }),
        "Tables",
        unavailable,
        null
      ),
      settle<MenuResponse | null>(
        () => apiClient.get<MenuResponse>("/menu", { params: { limit: 100 } }),
        "Menu",
        unavailable,
        null
      ),
      settle<CategoriesResponse | null>(
        () => apiClient.get<CategoriesResponse>("/categories"),
        "Categories",
        unavailable,
        null
      ),
      settle<StaffResponse | null>(
        () => apiClient.get<StaffResponse>("/users"),
        "Staff",
        unavailable,
        null
      ),
    ]);

  const telemetry: DashboardTelemetry | null = live?.telemetry
    ? {
        available: true,
        grossRevenue: Number(live.telemetry.grossRevenue || 0),
        paidOrderCount: Number(live.telemetry.paidOrderCount || 0),
        activeTickets: Number(live.telemetry.activeTickets || 0),
        customerInflux: Number(live.telemetry.customerInflux || 0),
        avgFulfillmentMinutes: Number(live.telemetry.avgFulfillmentMinutes || 0),
        statusCounts: live.telemetry.statusCounts || {},
        channelCounts: live.telemetry.channelCounts || {},
      }
    : null;

  // ── Setup progress ────────────────────────────────────────────────
  // Derived from what actually exists, not from a stored checklist, so it
  // cannot drift out of sync with reality.
  const tableCount = tables?.totalCount ?? tables?.tables?.length ?? 0;
  const menuCount = menu?.count ?? menu?.menuItems?.length ?? 0;
  const categoryCount = categories?.count ?? categories?.categories?.length ?? 0;
  const staffCount = staff?.users?.length ?? 0;
  const cafeDoc = cafe?.cafe ?? null;
  const reviewSettingsConfigured = reviews?.available !== false;

  const checks: SetupCheck[] = [
    {
      key: "profile",
      label: "Café profile",
      detail: cafeDoc?.name ? `${cafeDoc.name} is live` : "Add your café name and address",
      done: Boolean(cafeDoc?.name && cafeDoc?.address),
      href: "/cafe/settings",
    },
    {
      key: "categories",
      label: "Menu categories",
      detail: categoryCount
        ? `${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}`
        : "Create at least one category",
      done: categoryCount > 0,
      href: "/cafe/menu",
    },
    {
      key: "menu",
      label: "Menu items",
      detail: menuCount ? `${menuCount} item${menuCount === 1 ? "" : "s"} live` : "Add your first dish",
      done: menuCount > 0,
      href: "/cafe/menu",
    },
    {
      key: "tables",
      label: "Tables & QR codes",
      detail: tableCount
        ? `${tableCount} table${tableCount === 1 ? "" : "s"} ready to scan`
        : "Add tables so guests can scan",
      done: tableCount > 0,
      href: "/cafe/tables",
    },
    {
      key: "staff",
      label: "Team access",
      detail: staffCount
        ? `${staffCount} staff member${staffCount === 1 ? "" : "s"}`
        : "Invite staff and assign roles",
      done: staffCount > 1,
      href: "/cafe/settings",
    },
    {
      key: "reviews",
      label: "Google reviews",
      detail: reviewSettingsConfigured
        ? "Connected — happy guests can leave a review"
        : "Connect Google to collect reviews",
      done: Boolean(reviews?.available),
      href: "/cafe/reviews",
    },
  ];

  const completed = checks.filter((c) => c.done).length;

  // ── Billing centre ───────────────────────────────────────────────
  // `getBills` enriches each session with `runningTotal` (it spreads the
  // session document, so `tableNumber` arrives already denormalised).
  const billRows: BillingRow[] = (bills?.bills || []).slice(0, 8).map((b) => ({
    id: String(b._id || b.id),
    sessionId: String(b._id || b.id),
    tableNumber:
      typeof b.tableId === "object" && b.tableId?.tableNumber
        ? b.tableId.tableNumber
        : b.tableNumber || "—",
    customerName: b.customerName || "Guest",
    status: b.status || "active",
    orderCount: b.orderCount || 0,
    total: Number(b.runningTotal ?? b.totalAmount ?? 0),
    createdAt: b.createdAt || b.startedAt || new Date().toISOString(),
  }));

  return {
    cafe: cafeDoc
      ? {
          // The header renders the café name unconditionally, so an unnamed
          // profile used to crash the dashboard with `undefined` here.
          name: cafeDoc.name || "Unnamed café",
          address: cafeDoc.address,
          phone: cafeDoc.phone,
        }
      : null,
    telemetry,
    setup: { checks, completed, total: checks.length },
    billing: { available: Boolean(bills?.bills), rows: billRows },
    settlement: settlement?.byMethod
      ? {
          available: true,
          // Same as the café name: the date is rendered as-is, so it cannot be
          // left undefined.
          date: settlement.date || "",
          totalBills: settlement.totalBills || 0,
          byMethod: settlement.byMethod,
          totalRevenue: Number(settlement.totalRevenue || 0),
          totalGST: Number(settlement.totalGST || 0),
        }
      : null,
    review: reviews?.summary
      ? {
          available: true,
          averageRating: Number(reviews.summary.averageRating || 0),
          total: Number(reviews.summary.total || 0),
          pendingAction: Number(reviews.summary.pendingActionCount || 0),
        }
      : null,
    unavailable,
  };
}