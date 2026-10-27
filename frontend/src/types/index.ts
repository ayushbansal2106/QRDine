export type OrderStatus = "PENDING" | "ACCEPTED" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";
export type TableStatus = "FREE" | "OCCUPIED" | "ASSISTANCE_REQUIRED";
export type RequestStatus = "PENDING" | "RESOLVED";

export interface Restaurant {
  id: string;
  name: string;
  logo?: string | null;
  address: string;
  phone: string;
  createdAt: Date;
}

export interface Admin {
  id: string;
  email: string;
  role: "ADMIN" | "STAFF";
  createdAt: Date;
}

export interface Table {
  id: string;
  tableNumber: number;
  qrCodeUrl?: string | null;
  status: TableStatus;
  createdAt: Date;
}

export interface MenuCategory {
  id: string;
  name: string;
  displayOrder: number;
  items?: MenuItem[];
}

export type PrepStation = "kitchen" | "bar" | "both";

export interface MenuVariant {
  _id?: string;
  name: string;
  price: number;
  isDefault?: boolean;
}

export interface MenuModifierOption {
  _id?: string;
  name: string;
  price: number;
  isDefault?: boolean;
}

export interface MenuModifierGroup {
  _id?: string;
  name: string;
  selectionType: "single" | "multi";
  isRequired?: boolean;
  min?: number;
  max?: number;
  options: MenuModifierOption[];
}

export interface MenuItem {
  id: string;
  categoryId: string;
  category?: MenuCategory;
  name: string;
  description: string;
  imageUrl?: string | null;
  price: number; // Decimal converted to number for frontend
  gstPercentage: number;
  available: boolean;
  featured: boolean;
  preparationTime: number;
  // Module #05/#06 — variant & modifier configuration
  variants?: MenuVariant[];
  modifierGroups?: MenuModifierGroup[];
  dietaryTags?: string[];
  ingredients?: string[];
  allergens?: string[];
  calories?: number;
  prepStation?: PrepStation;
  // Module #06 — customer-facing showcase content
  story?: string;
  media?: MenuItemMedia[];
  allergenNote?: string;
  spiceLevel?: number;
  prepMinutes?: number;
}

export interface MenuItemMedia {
  url: string;
  caption?: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  menuItemId: string;
  menuItem?: MenuItem;
  quantity: number;
  price: number;
  name?: string;
  gstPercentage?: number;
  gstAmount?: number;
}

export type OrderType = "dine_in" | "takeaway" | "delivery";
export type OrderChannel = "qr" | "pos" | "waiter" | "online";
export type PaymentStatus = "unpaid" | "paid" | "refunded" | "partially_refunded";

export interface Order {
  id: string;
  orderNumber: string;
  orderType?: OrderType;
  channel?: OrderChannel;
  paymentStatus?: PaymentStatus;
  tableId: string;
  table?: Table;
  status: OrderStatus;
  subtotal?: number;
  totalGST?: number;
  serviceCharge?: number;
  totalAmount: number;
  taxBreakdown?: { percentage: number; amount: number }[];
  /**
   * Server-computed discounts (Module #02/#14). The confirmation screen and the
   * bills board both break these out so the guest can see what they saved;
   * without them the arithmetic on screen does not add up to `totalAmount`.
   */
  discountTotal?: number;
  discounts?: { label?: string; type?: string; amount?: number; couponCode?: string }[];
  notes?: string | null;
  items?: OrderItem[];
  createdAt: Date;
  acceptedAt?: Date | null;
  preparingAt?: Date | null;
  readyAt?: Date | null;
  servedAt?: Date | null;
  cancelledAt?: Date | null;
  placedByParticipantId?: string | null;
  placedByName?: string | null;
  /** Module #03 — presentation metadata delivered with the `new-order` socket event. */
  meta?: NewOrderMeta;
}

export interface WaiterRequest {
  id: string;
  tableId: string;
  table?: Table;
  requestType: string;
  status: RequestStatus;
  createdAt: Date;
}

export interface SelectedModifier {
  groupId?: string;
  groupName: string;
  optionId?: string;
  optionName: string;
  price: number;
}

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  // Module #05 — the customer's chosen variant/modifiers travel with the line.
  variantId?: string;
  variantName?: string;
  modifiers?: SelectedModifier[];
  notes?: string;
  /** Server-priced unit price (variant + modifiers). Falls back to menu price. */
  unitPrice?: number;
}

// Sprint 7.5 & 7.6 — Dining Sessions & Billing
export type SessionStatus = "ACTIVE" | "BILL_REQUESTED" | "AWAITING_PAYMENT" | "PAID" | "CLOSED";
export type PaymentMethod = "PENDING" | "PAID_COUNTER" | "PAID_ONLINE";

export interface DiningSession {
  id: string;
  cafeId: string;
  tableId: string;
  table?: Table;
  customerName: string;
  customerEmail: string;
  status: SessionStatus;
  startedAt: Date;
  endedAt?: Date | null;
  subtotal: number;
  gst: number;
  totalAmount: number;
  invoiceNumber?: string | null;
  paymentMethod: PaymentMethod;
  orders?: Order[];
  orderCount?: number;
  runningTotal?: number;
  participants?: SessionParticipant[];
  customerId?: string | null;
  loyalty?: LoyaltySnapshot | null;
}

/**
 * A diner seated at a session, as stored on `DiningSession.participants`.
 *
 * This lives here rather than in the components that read it because three
 * surfaces touch it (the bills board, the session gate, the customer bill
 * modal) and only the bills board had a type for it.
 */
export interface SessionParticipant {
  participantId: string;
  name: string;
  role: "owner" | "member";
  status: "active" | "left";
  deviceId?: string;
  email?: string;
}

export interface Invoice {
  id: string;
  sessionId: string;
  invoiceNumber: string;
  pdfUrl: string;
  generatedAt: Date;
}

export interface DailySummary {
  id: string;
  date: Date;
  totalRevenue: number;
  gstCollected: number;
  orderCount: number;
  sessionCount: number;
  averageOrderValue: number;
  customerCount: number;
}

// Module #09 — Customer CRM

export interface Customer {
  _id: string;
  cafeId: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  dietary: string[];
  tags: string[];
  birthday?: string | null;
  visitCount: number;
  lifetimeSpend: number;
  avgSpend: number;
  firstSeenAt?: string;
  lastVisitAt?: string | null;
}

// Settings — Cafe Profile & Staff

export interface CafeProfile {
  id: string;
  name: string;
  legalName?: string;
  tradeName?: string;
  gstin?: string;
  fssaiNumber?: string;
  taxMode?: "composite_5" | "regular_18" | "exempt";
  tableCount?: number;
  termsAccepted?: boolean;
  termsAcceptedAt?: Date | string;
  logo: string;
  address: string;
  phone: string;
  email: string;
  isOrderingPaused?: boolean;
  orderingPausedReason?: string;
  operatingHours?: {
    enabled?: boolean;
    openTime?: string;
    closeTime?: string;
    days?: number[];
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface IncidentRecord {
  incidentId: string;
  severity: "SEV-1" | "SEV-2" | "SEV-3";
  cafeId?: string | null;
  affectedOrderId?: string | null;
  category: "billing" | "data_isolation" | "realtime_outage" | "security_breach" | "operational";
  title: string;
  description: string;
  sanitizedLogs?: Record<string, unknown> | null;
  isPersonalDataInvolved: boolean;
  status: "open" | "investigating" | "mitigated" | "resolved" | "closed";
  reportedBy: string;
  remediationNotes?: string;
  certInReported: boolean;
  certInReportedAt?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StaffRole = "owner" | "manager" | "cashier" | "waiter" | "barista" | "staff";

export interface StaffUser {
  id: string;
  cafeId: string;
  name: string;
  email: string;
  role: StaffRole;
  permissions: string[];
  hasCustomPermissions?: boolean;
  pinEnabled: boolean;
  pinSetAt?: string | null;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Module #08 — Staff & RBAC
export interface PermissionCatalog {
  permissions: string[];
  roleDefaults: Record<string, string[]>;
  roles: string[];
  assignableRoles: string[];
}

export interface Operator {
  id: string;
  name: string;
  role: StaffRole;
  pinEnabled: boolean;
}

export interface ShiftPaymentsBreakdown {
  cash: number;
  upi_manual: number;
  card_manual: number;
  wallet: number;
  online: number;
}

export interface Shift {
  id: string;
  cafeId: string;
  openedBy: string;
  openedByName: string;
  openedAt: string;
  openingFloat: number;
  closedBy: string | null;
  closedByName: string;
  closedAt: string | null;
  closingFloat: number | null;
  status: "open" | "closed";
  notes: string;
  breakdown: ShiftPaymentsBreakdown;
  cashSales: number;
  totalSales: number;
  orderCount: number;
  expectedCash: number;
  difference: number | null;
}

// Module #14 — Coupons & promotions

export type CouponType = "percent" | "flat";

export interface Coupon {
  _id: string;
  cafeId: string;
  code: string;
  description: string;
  type: CouponType;
  value: number;
  minOrder: number;
  maxDiscount: number;
  appliesTo: {
    scope: "all" | "items" | "categories";
    itemIds: string[];
    categoryIds: string[];
    customerIds?: string[];
  };
  /**
   * Who the offer is for.
   *
   * A rule rather than a list of names, evaluated against each customer's live
   * profile at redemption — so "inactive for 30 days" still means that next
   * month. `customers` is the hand-picked list kept for one-off cases.
   */
  audience?: {
    mode: "all" | "customers" | "segment";
    rules: { field: string; op: string; value: string | number | boolean }[];
  };
  /** Personal delivery: each matched profile gets its own code. */
  autoIssue?: { enabled: boolean; repeatEveryDays: number };
  validFrom: string | null;
  validTo: string | null;
  happyHour: { enabled: boolean; days: number[]; start: string; end: string };
  singleUse: boolean;
  usageLimit: number;
  perCustomerLimit: number;
  usageCount: number;
  isActive: boolean;
  createdAt: string;
}

// Module #15 — Loyalty stamps

export type RewardType = "free_item" | "flat_off" | "percent_off";

export interface LoyaltyProgram {
  _id?: string;
  cafeId?: string;
  name: string;
  isActive: boolean;
  stampsRequired: number;
  minSpend: number;
  qualifyingScope: "all" | "items" | "categories";
  qualifyingItemIds: string[];
  qualifyingCategoryIds: string[];
  stampsPerOrder: number;
  reward: { type: RewardType; value: number; menuItemId: string | null; label: string };
  voucherValidDays: number;
}

export interface RewardVoucher {
  _id?: string;
  code: string;
  label: string;
  type: RewardType;
  value: number;
  menuItemId?: string | null;
  status: "active" | "redeemed" | "expired";
  earnedAt: string;
  expiresAt: string | null;
  redeemedAt: string | null;
}

export interface LoyaltyCard {
  _id: string;
  cafeId: string;
  customerId: Customer | string;
  stamps: number;
  lifetimeStamps: number;
  vouchers: RewardVoucher[];
  lastStampAt: string | null;
}

export interface CustomerLoyaltySummary {
  program: LoyaltyProgram | null;
  stamps: number;
  lifetimeStamps: number;
  stampsRequired: number;
  lastStampAt: string | null;
  vouchers: RewardVoucher[];
  activeVouchers: RewardVoucher[];
}

/**
 * The slice of a guest's loyalty card the till needs — stamp progress plus the
 * vouchers that can still be spent. Attached to every bills row and to the
 * session detail, because settling the bill is what moves the card.
 */
export interface LoyaltySnapshot {
  programName: string;
  stamps: number;
  lifetimeStamps: number;
  stampsRequired: number;
  stampsToReward: number;
  vouchers: {
    code: string;
    label: string;
    type: string;
    value: number;
    expiresAt?: string | null;
  }[];
}

// Module #17 — Prepaid wallet

export interface Wallet {
  _id: string;
  cafeId: string;
  customerId: Customer | string;
  balance: number;
  currency: string;
  isActive: boolean;
  totalTopups: number;
  totalSpent: number;
  lastTransactionAt: string | null;
}

export type WalletTransactionType = "topup" | "bonus" | "payment" | "refund" | "adjustment";

export interface WalletTransaction {
  _id: string;
  type: WalletTransactionType;
  amount: number;
  balanceAfter: number;
  reference: string;
  note: string;
  orderId?: string | null;
  staffName?: string;
  createdAt: string;
}

// Module #16 — Scratch cards

export type ScratchPrizeType = "flat_off" | "percent_off" | "free_item" | "none";

export interface ScratchPrize {
  _id?: string;
  label: string;
  type: ScratchPrizeType;
  value: number;
  menuItemId?: string | null;
  weight: number;
  stock: number;
  claimed: number;
}

export interface ScratchCampaign {
  _id?: string;
  cafeId?: string;
  name: string;
  isActive: boolean;
  prizes: ScratchPrize[];
  eligibleMinSpend: number;
  maxCardsPerDay: number;
  maxCardsPerCustomer: number;
  voucherValidDays: number;
  startAt?: string | null;
  endAt?: string | null;
}

export interface ScratchCard {
  _id: string;
  cafeId: string;
  customerId: Customer | string;
  orderId?: string | null;
  prize: { label: string; type: ScratchPrizeType; value: number; menuItemId?: string | null };
  voucherCode?: string | null;
  status: "issued" | "revealed" | "expired";
  issuedAt: string;
  revealedAt?: string | null;
  expiresAt?: string | null;
}

// Module #13 — Waiter handheld

export interface WaiterTable {
  _id: string;
  tableNumber: number;
  status: "free" | "occupied";
  sessionId: string | null;
  sessionStatus: string | null;
  orderCount: number;
  runningTotal: number;
}

export interface WaiterMetrics {
  ordersTaken: number;
  revenue: number;
  itemsServed: number;
  avgTicket: number;
}

// Sprint 8 — Analytics & Business Intelligence

export interface AnalyticsOverview {
  revenueToday: number;
  revenueChange: number;
  ordersToday: number;
  orderChange: number;
  avgOrderValue: number;
  activeTables: number;
  totalTables: number;
  sessionsToday: number;
  tableTurnover: number;
}

export interface RevenueDailyData {
  date: string;
  revenue: number;
  orders: number;
}

export interface PeakDay {
  day: string;
  totalRevenue: number;
  avgRevenue: number;
}

export interface RevenueAnalytics {
  period: string;
  currentRevenue: number;
  previousRevenue: number;
  growthPercent: number;
  dailyData: RevenueDailyData[];
  peakDays: PeakDay[];
}

export interface GSTSlab {
  percentage: number;
  amount: number;
}

export interface GSTAnalytics {
  period: string;
  totalGST: number;
  slabs: GSTSlab[];
}

export interface ItemStat {
  menuItemId: string;
  itemName: string;
  quantity: number;
  revenue: number;
}

export interface ItemsAnalyticsData {
  period: string;
  bestByQuantity: ItemStat[];
  bestByRevenue: ItemStat[];
  worstPerformers: ItemStat[];
  totalItems: number;
}

export interface TableStat {
  tableId: string;
  tableNumber: string;
  revenue: number;
  orderCount: number;
  sessionCount: number;
  avgSessionDuration: number;
  turnoverRate: number;
  isOccupied: boolean;
}

export interface TableAnalyticsData {
  period: string;
  tables: TableStat[];
}

export interface ConversionFunnel {
  sessionsStarted: number;
  ordersPlaced: number;
  billsRequested: number;
  paymentsCompleted: number;
}

export interface SessionAnalyticsData {
  period: string;
  totalSessions: number;
  avgDuration: number;
  longestSession: number;
  shortestSession: number;
  closedCount: number;
  funnel: ConversionFunnel;
}

export interface TopCustomer {
  email: string;
  name: string;
  visits: number;
  totalRevenue: number;
  isReturning: boolean;
}

export interface CustomerAnalyticsData {
  period: string;
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  newPercent: number;
  returningPercent: number;
  topCustomers: TopCustomer[];
}

export interface PaymentAnalyticsData {
  period: string;
  onlineCount: number;
  counterCount: number;
  onlinePercent: number;
  counterPercent: number;
  onlineRevenue: number;
  counterRevenue: number;
  avgOnlineTicket: number;
  avgCounterTicket: number;
}

// --- Module #10 — geo-location fake-order prevention -------------------------

export interface GeofenceConfig {
  enabled: boolean;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  fallback: "flag" | "reject";
  flagThreshold?: number;
  velocityLimit?: number;
}

export interface GeofenceStats {
  totalFlagged: number;
  pendingFlagged: number;
  unverified: number;
  rejected: number;
}

export interface GeofenceVerification {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  distanceMeters: number | null;
  radiusMeters?: number;
  verified: boolean;
  flagged: boolean;
  riskScore: number;
  reasons: string[];
  decision: "accept" | "flag" | "reject" | "unchecked";
  velocity?: { recentOrderCount: number; impliedSpeedMps: number | null };
  checkedAt?: string | null;
  reviewOutcome?: "pending" | "confirmed_legit" | "confirmed_fraud" | null;
  reviewedAt?: string | null;
  reviewNote?: string;
}

export interface GeofenceFlag {
  id: string;
  orderNumber: string;
  orderType: string;
  channel: string;
  status: string;
  totalAmount: number;
  tableNumber: string | null;
  customer: { name?: string; phone?: string } | null;
  createdAt: string;
  geolocation: GeofenceVerification;
}

// --- Module #11 — NFC tap tags ------------------------------------------------

export type NfcDestination = "menu" | "google_review" | "instagram" | "custom";

export interface NfcTag {
  id: string;
  tagId: string;
  label: string;
  destination: NfcDestination;
  targetUrl: string;
  tableId: string | null;
  tableNumber: string | null;
  isActive: boolean;
  tapCount: number;
  lastTapAt: string | null;
  payloadUrl: string;
  notes: string;
}

export interface NfcTagCard {
  tagId: string;
  label: string;
  payloadUrl: string;
  ndefRecord: { recordType: string; url: string };
  resolvesTo: string;
  destinationUrl: string | null;
  qrDataUrl: string;
}

export interface NfcStats {
  total: number;
  active: number;
  totalTaps: number;
  lastTapAt: string | null;
}

// --- Module #18 — review engine ----------------------------------------------

export interface ReviewAi {
  sentiment: "positive" | "neutral" | "negative" | "mixed" | null;
  themes: string[];
  summary: string;
  draft: string;
  ownerReplyDraft: string;
  model: string;
  generatedAt: string | null;
  error: string;
}

export interface Review {
  id: string;
  cafeId?: string;
  orderId?: string | { orderNumber: string; totalAmount: number };
  sessionId?: string | null;
  customerId?: string | { name: string; phone: string };
  rating: number;
  tags: string[];
  comment: string;
  visibility: "public_draft" | "private_feedback";
  status: "new" | "drafted" | "acknowledged" | "actioned" | "dismissed";
  ai: ReviewAi;
  published: boolean;
  publishedAt: string | null;
  ownerReply: string;
  repliedAt: string | null;
  internalNote: string;
  createdAt: string;
}

export interface ReviewSummary {
  total: number;
  averageRating: number;
  distribution: Record<string, number>;
  topThemes: { theme: string; count: number }[];
  responseRate: number;
  privateFeedbackCount: number;
  pendingActionCount: number;
  aiDigest: string;
  recent: {
    id: string;
    rating: number;
    comment: string;
    tags: string[];
    visibility: string;
    status: string;
    createdAt: string;
  }[];
}

export interface ReviewSettings {
  googlePlaceId: string;
  googleReviewUrl: string;
  aiEnabled: boolean;
  minRatingForGoogle: number;
  brandVoice: string;
  promptDelayHours: number;
  promptSampleRate: number;
  autoSendLowRatingAlerts: boolean;
}

export interface ReviewOutcome {
  visibility: "public_draft" | "private_feedback";
  googleReviewUrl: string;
  draft: string;
  message: string;
}

// --- Module #01 — telemetry ---------------------------------------------------

export interface LiveTelemetry {
  grossRevenue: number;
  paidOrderCount: number;
  activeTickets: number;
  customerInflux: number;
  avgFulfillmentMinutes: number;
  statusCounts: Record<string, number>;
  channelCounts?: Record<string, number>;
  orderTypeBreakdown: Record<string, Record<string, number>>;
  recentOrders: {
    id: string;
    orderNumber: string;
    orderType: string;
    channel: string;
    status: string;
    totalAmount: number;
    tableNumber: string | null;
    createdAt: string;
  }[];
}

export interface PeakHoursData {
  windowDays: number;
  totalOrders: number;
  hourly: {
    hour: number;
    orderCount: number;
    paidRevenue: number;
    cancelled: number;
    avgTicket: number;
  }[];
  heatmap: number[][];
  peakHour: number | null;
  peakOrderCount: number;
}

export interface TurnoverData {
  windowDays: number;
  activeTables: number;
  totalSessions: number;
  closedSessions: number;
  turnoverRate: number;
  avgSessionsPerTable: number;
  avgSessionMinutes: number;
  occupancyPct: number;
  hourly: { hour: number; sessionsStarted: number; sessionsClosed: number; revenue: number }[];
  byTable: { tableId: string; sessions: number; revenue: number }[];
}

export interface OutletConsolidation {
  scope: "single" | "group";
  outletGroup?: string;
  excludedCount?: number;
  reason?: string;
  outlets: string[];
  totals: {
    windowDays: number;
    outletCount: number;
    totals: {
      revenue: number;
      orderCount: number;
      paidOrders: number;
      cancellations: number;
      avgTicket: number;
      bestOutlet: string | null;
    };
    outlets: {
      cafeId: string;
      name: string;
      outletLabel: string;
      orderCount: number;
      paidOrders: number;
      revenue: number;
      cancellations: number;
      avgTicket: number;
    }[];
  } | null;
}

// --- Module #03 — pipeline actions -------------------------------------------

export interface OrderRefund {
  amount: number;
  method: string;
  reason: string;
  destination: "wallet_balance" | "external";
  staffName: string;
  refundedAt: string;
}

export interface NewOrderMeta {
  sound: boolean;
  channel: string;
  orderType: string;
  flagged: boolean;
  receivedAt: string;
  addedToExisting?: boolean;
  reassigned?: boolean;
}

// --- Subscription entitlements (server-resolved, never client-authoritative) ---

/**
 * What the tenant's plan permits *right now*.
 *
 * Everything here is resolved on the backend from the subscription row and the
 * plan catalogue. The frontend uses it to decide what to show — never to decide
 * what is allowed: every protected endpoint re-checks the same rules server-side,
 * so editing this object in devtools changes nothing but the UI.
 */
export interface TenantEntitlements {
  planKey: string;
  planName: string;
  planVersion: string;
  planVersionIsCurrent: boolean;
  status: "trialing" | "active" | "grace" | "degraded" | "cancelled" | "terminated";
  isTerminated: boolean;
  isDegraded: boolean;
  isCancelled: boolean;
  inGrace: boolean;
  isPayable: boolean;
  paidUntil: string | null;
  features: string[];
  blockedFeatures: string[];
}

/** One metered allowance and how much of it is spent. */
export interface UsageSummary {
  metric: string;
  label: string;
  unit: string;
  period: "month" | "lifetime";
  periodKey: string;
  periodStart: string | null;
  periodEnd: string | null;
  limit: number | null;
  unlimited: boolean;
  used: number;
  reserved: number;
  remaining: number | null;
  onExhausted: "block";
}
