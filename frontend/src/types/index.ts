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

export interface Order {
  id: string;
  orderNumber: string;
  tableId: string;
  table?: Table;
  status: OrderStatus;
  subtotal?: number;
  totalGST?: number;
  serviceCharge?: number;
  totalAmount: number;
  taxBreakdown?: { percentage: number; amount: number }[];
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
}

export interface WaiterRequest {
  id: string;
  tableId: string;
  table?: Table;
  requestType: string;
  status: RequestStatus;
  createdAt: Date;
}

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
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
  participants?: any[];
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

// Settings — Cafe Profile & Staff

export interface CafeProfile {
  id: string;
  name: string;
  logo: string;
  address: string;
  phone: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffUser {
  id: string;
  cafeId: string;
  name: string;
  email: string;
  role: "owner" | "manager" | "staff";
  createdAt: Date;
  updatedAt: Date;
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

