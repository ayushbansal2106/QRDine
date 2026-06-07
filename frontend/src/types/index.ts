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
