import type {
  Customer,
  MenuCategory,
  MenuItem,
  MenuModifierGroup,
  MenuModifierOption,
  MenuVariant,
  NewOrderMeta,
  Order,
  OrderChannel,
  OrderItem,
  OrderStatus,
  OrderType,
  PaymentStatus,
  PrepStation,
  RequestStatus,
  Table,
  TableStatus,
  WaiterRequest,
} from "@/types";

/**
 * ── The raw wire boundary ────────────────────────────────────────────────────
 *
 * Everything the API returns is a *Mongoose document*: `_id` instead of `id`,
 * statuses in lower case, `tableId` either an ObjectId string or a populated
 * object, prices as whatever `Decimal128` serialised to. `src/types/index.ts`
 * describes the *clean* shapes the UI wants, which is right — but nothing
 * described the messy side, so eight separate files each hand-wrote a
 * `mapDbXToX(order: any)` and each invented its own guesses.
 *
 * That is the root cause of the remaining `explicit any`s, not a shortage of
 * casts. So the raw shapes are declared once, here, and every surface maps
 * through the same functions.
 *
 * Field optionality is not defensive noise: it mirrors the Mongoose schemas
 * exactly (`backend/src/models/`). A field is optional only where the schema
 * says `default: null`, or where the document is sparse (`_id` missing on
 * pre-existing order items, per `cancelOrderItem`'s fallback path).
 */

// ── Raw documents ────────────────────────────────────────────────────────────

/** A populated `Table`, as `.populate("tableId", "tableNumber")` returns it. */
export interface RawTable {
  _id: string;
  tableNumber: string;
  qrCodeUrl?: string;
  /** Present only when the populate projection includes it. */
  isActive?: boolean;
  createdAt?: string;
}

/**
 * A `Table` from `GET /tables`, which returns whole documents rather than the
 * narrowed projection a populated `tableId` carries — so `guestUrl` and
 * `isActive` are always present here.
 */
export interface RawQrTable extends RawTable {
  isActive: boolean;
  guestUrl?: string;
  qrCodeUrl?: string;
  createdAt: string;
}

/** A `Customer` document, as `GET /customers` returns them. */
export interface RawCustomer {
  _id: string;
  cafeId?: string;
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
  dietary?: string[];
  tags?: string[];
  birthday?: string | null;
  visitCount?: number;
  /** Decimal128 arrives as a string over JSON. */
  lifetimeSpend?: number | string;
  avgSpend?: number | string;
  firstSeenAt?: string;
  lastVisitAt?: string | null;
}

/**
 * `tableId` on an order: an ObjectId string when unpopulated (takeaway, or the
 * public tracking endpoint), a `RawTable` when `.populate()` ran.
 */
export type RawTableRef = string | RawTable | null;

export interface RawOrderItem {
  /** Missing on items stored before per-item ids were added. */
  _id?: string;
  menuItemId: string;
  /** Admin endpoints send the stored field name. */
  itemName?: string;
  /** The public endpoint renames it to `name`. */
  name?: string;
  quantity: number;
  /** Decimal128 arrives as a string over JSON. */
  price: number | string;
  gstPercentage?: number;
  gstAmount?: number;
  status?: string;
  cancellationReason?: string | null;
  modifiers?: { name: string; price: number }[];
  prepStation?: string;
  seat?: string | null;
  notes?: string;
}

/** The `new-order` socket payload — a whole order plus presentation metadata. */
export interface RawOrderSocketPayload extends RawOrder {
  meta?: Partial<NewOrderMeta>;
}

export interface RawOrder {
  _id?: string;
  id?: string;
  orderNumber?: string;
  orderType?: string;
  channel?: string;
  paymentStatus?: string;
  tableId?: RawTableRef;
  /**
   * The public tracking endpoint sends a `table` stub (number only, or the
   * literal `"N/A"`), not a populated `tableId`.
   */
  table?: { tableNumber?: string | number } | null;
  status?: string;
  notes?: string | null;
  items?: RawOrderItem[];
  createdAt?: string;
  acceptedAt?: string | null;
  preparingAt?: string | null;
  readyAt?: string | null;
  servedAt?: string | null;
  cancelledAt?: string | null;
  subtotal?: number | string;
  totalGST?: number | string;
  serviceCharge?: number | string;
  totalAmount?: number | string;
  taxBreakdown?: { percentage: number; amount: number }[];
  discountTotal?: number;
  discounts?: { label?: string; type?: string; amount?: number; couponCode?: string }[];
  /** Presentation metadata, present only on the `new-order` socket payload. */
  meta?: Partial<NewOrderMeta>;
}

export interface RawWaiterRequest {
  _id?: string;
  tableId?: RawTableRef;
  requestType?: string;
  status?: string;
  createdAt?: string;
}

/** A `Category` document, as `/categories` returns them. */
export interface RawCategory {
  _id: string;
  name: string;
  displayOrder?: number;
}

/** A `MenuItem` document, as `/menu` returns them. */
export interface RawMenuItem {
  _id: string;
  categoryId: string;
  name: string;
  description?: string;
  /** Stored as `image`; the UI calls it `imageUrl`. */
  image?: string;
  price: number | string;
  gstPercentage?: number;
  isAvailable?: boolean;
  variants?: RawMenuVariant[];
  modifierGroups?: RawMenuModifierGroup[];
  dietaryTags?: string[];
  ingredients?: string[];
  allergens?: string[];
  calories?: number | string;
  prepStation?: PrepStation;
}

export interface RawMenuVariant {
  _id?: string;
  name: string;
  price: number | string;
  isDefault?: boolean;
}

export interface RawMenuModifierOption {
  _id?: string;
  name: string;
  price: number | string;
  isDefault?: boolean;
}

export interface RawMenuModifierGroup {
  _id?: string;
  name: string;
  selectionType: "single" | "multi";
  isRequired?: boolean;
  min?: number;
  max?: number;
  options: RawMenuModifierOption[];
}

/** Payload of the `kds-item-updated` socket event. */
export interface KdsItemUpdatedPayload {
  orderId: string;
  itemId: string;
  status: string;
}

/** Payload of `order-accepted` / `order-ready` / `status-updated`. */
export interface OrderStatusEventPayload {
  orderId: string;
  status: string;
}

// ── Narrowing helpers ────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Upper-case a wire status and keep it only if it is a real `OrderStatus`.
 *
 * This is the check the codebase did not have. `(status as OrderStatus)` was a
 * promise, not a proof — and the Mongoose enum has `partially_served` and
 * `partially_cancelled`, which no column renders, so those tickets silently
 * vanished from the orders board. An unknown status now falls back to PENDING,
 * where they are visible and actionable, instead of matching no column at all.
 */
export const toOrderStatus = (value: unknown): OrderStatus => {
  const upper = String(value ?? "").toUpperCase();
  switch (upper) {
    case "ACCEPTED":
    case "PREPARING":
    case "READY":
    case "SERVED":
    case "CANCELLED":
      return upper;
    default:
      return "PENDING";
  }
};

const toRequestStatus = (value: unknown): RequestStatus =>
  String(value ?? "").toUpperCase() === "RESOLVED" ? "RESOLVED" : "PENDING";

const toOrderType = (value: unknown): OrderType => {
  switch (value) {
    case "takeaway":
    case "delivery":
      return value;
    default:
      return "dine_in";
  }
};

const toOrderChannel = (value: unknown): OrderChannel => {
  switch (value) {
    case "pos":
    case "waiter":
    case "online":
      return value;
    default:
      return "qr";
  }
};

const toPaymentStatus = (value: unknown): PaymentStatus => {
  switch (value) {
    case "paid":
    case "refunded":
    case "partially_refunded":
      return value;
    default:
      return "unpaid";
  }
};

const toDate = (value: unknown): Date =>
  value ? new Date(value as string | number) : new Date(0);

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

// ── Table ────────────────────────────────────────────────────────────────────

/**
 * Table status is derived, not stored.
 *
 * The schema has `isActive` (is the QR code live) and nothing else — so every
 * surface that renders a table had to invent a `TableStatus`. `ACTIVE` means
 * the table is in service; `FREE` is only meaningful once a session is open,
 * which the frontend does not receive here. Mapping `isActive` to `OCCUPIED`
 * as well as `FREE` would be a lie, so `ASSISTANCE_REQUIRED` is kept as the
 * "needs attention" signal and `TableStatus` stays honest about what it means.
 */
const toTableStatus = (isActive: boolean | undefined): TableStatus =>
  isActive ? "FREE" : "ASSISTANCE_REQUIRED";

/**
 * Normalise a `RawTableRef` into both the id and the populated table.
 *
 * Returns `undefined` for the table when the ref is an unpopulated id — the
 * UI distinguishes "no table" (takeaway) from "table not loaded", and the old
 * per-file mappers got this wrong in both directions.
 */
export const readTableRef = (
  ref: RawTableRef | undefined
): { tableId: string; table: Table | undefined } => {
  if (!ref) {
    return { tableId: "", table: undefined };
  }
  if (typeof ref === "string") {
    return { tableId: ref, table: undefined };
  }
  const tableNumber = toNumber(ref.tableNumber);
  return {
    tableId: ref._id ?? "",
    table: {
      id: ref._id ?? "",
      tableNumber,
      qrCodeUrl: ref.qrCodeUrl || `/table/${ref.tableNumber}`,
      status: toTableStatus(ref.isActive),
      createdAt: toDate(ref.createdAt),
    },
  };
};

export const mapRawTable = (raw: RawTable): Table => ({
  id: raw._id,
  tableNumber: toNumber(raw.tableNumber),
  status: toTableStatus(raw.isActive),
  qrCodeUrl: raw.qrCodeUrl || `/table/${raw.tableNumber}`,
  createdAt: toDate(raw.createdAt),
});

/** A table row on the QR management board, which also drives guest deep links. */
export type QrTableRow = Table & { isActive: boolean; guestUrl: string };

/**
 * `GET /tables` feeds two independent boards (tables + QR), which each used to
 * hand-roll this mapper — and hand-rolled it slightly differently.
 */
export const mapRawQrTable = (raw: RawQrTable): QrTableRow => ({
  ...mapRawTable(raw),
  isActive: raw.isActive !== false,
  guestUrl: raw.guestUrl || `https://qrdine.local/guest/${raw._id}`,
});

export const mapRawQrTables = (rows: RawQrTable[]): QrTableRow[] => rows.map(mapRawQrTable);

/** `GET /customers` → the clean `Customer` shape the board renders. */
export const mapRawCustomer = (raw: RawCustomer): Customer => ({
  _id: raw._id,
  cafeId: raw.cafeId ?? "",
  name: raw.name ?? "",
  phone: raw.phone ?? "",
  email: raw.email ?? "",
  notes: raw.notes ?? "",
  dietary: raw.dietary ?? [],
  tags: raw.tags ?? [],
  birthday: raw.birthday ?? null,
  visitCount: toNumber(raw.visitCount),
  lifetimeSpend: toNumber(raw.lifetimeSpend),
  avgSpend: toNumber(raw.avgSpend),
  firstSeenAt: raw.firstSeenAt,
  lastVisitAt: raw.lastVisitAt ?? null,
});

// ── Order items ──────────────────────────────────────────────────────────────

/**
 * The per-item fields an order item carries on the wire but `OrderItem` does not
 * declare.
 *
 * `OrderItem` predates the kitchen display system and the order-detail screen;
 * both read `status` off every item, the kitchen board also needs
 * `prepStation`/`modifiers`/`seat`/`notes`, and the detail screen needs
 * `cancellationReason`. Declaring them as a separate intersection keeps
 * `OrderItem` honest for the customer-facing surfaces that genuinely never see
 * them, and gives staff surfaces the type they actually need instead of `any`.
 */
export type StaffOrderItem = OrderItem & {
  status: string;
  prepStation: "kitchen" | "bar" | "both";
  modifiers: { name: string; price: number }[];
  seat: string | null;
  notes: string;
  cancellationReason: string | null;
};

const mapRawOrderItem = (
  raw: RawOrderItem,
  idx: number,
  orderStatus: string
): StaffOrderItem => {
  const name = raw.itemName || raw.name || "Unknown Item";
  const price = toNumber(raw.price);
  return {
    id: raw._id ?? String(idx),
    orderId: "",
    menuItemId: raw.menuItemId,
    quantity: toNumber(raw.quantity, 1),
    price,
    name,
    gstPercentage: toNumber(raw.gstPercentage),
    gstAmount: toNumber(raw.gstAmount),
    status: raw.status || orderStatus,
    prepStation:
      raw.prepStation === "bar" || raw.prepStation === "both"
        ? raw.prepStation
        : "kitchen",
    modifiers: raw.modifiers ?? [],
    seat: raw.seat ?? null,
    notes: raw.notes ?? "",
    cancellationReason: raw.cancellationReason ?? null,
  };
};

// ── Order ────────────────────────────────────────────────────────────────────

/**
 * The one order mapper. Every surface — the orders board, the kitchen board,
 * the admin detail page, both `new-order` listeners — goes through this.
 *
 * `readyAt` and the other timestamps are carried through because the kitchen
 * board computes average prep time from them. They were dropped by three of
 * the four hand-written mappers, so `avgPrepMinutes` was permanently `0`:
 * `orders.filter((o) => o.readyAt && o.createdAt)` never matched anything.
 */
export const mapRawOrder = (raw: RawOrder): Order => {
  const { tableId, table } = readTableRef(raw.tableId);
  // The public endpoint uses `table: { tableNumber }`; fold it into the same
  // shape so the tracking page and the staff pages read `order.table` alike.
  // Its "no table" value is the literal string "N/A", not null.
  const publicTableNumber = raw.table?.tableNumber;
  const resolvedTable =
    table ??
    (publicTableNumber !== undefined && publicTableNumber !== "N/A"
      ? {
          id: "",
          tableNumber: toNumber(publicTableNumber),
          qrCodeUrl: `/table/${publicTableNumber}`,
          status: "ASSISTANCE_REQUIRED" as TableStatus,
          createdAt: new Date(0),
        }
      : undefined);
  const rawStatus = String(raw.status ?? "pending");
  const items = (raw.items ?? []).map((item, idx) =>
    mapRawOrderItem(item, idx, rawStatus)
  );

  return {
    id: raw._id ?? raw.id ?? "",
    orderNumber: raw.orderNumber ?? "",
    orderType: toOrderType(raw.orderType),
    channel: toOrderChannel(raw.channel),
    paymentStatus: toPaymentStatus(raw.paymentStatus),
    tableId,
    table: resolvedTable,
    status: toOrderStatus(raw.status),
    subtotal: toNumber(raw.subtotal),
    totalGST: toNumber(raw.totalGST),
    serviceCharge: toNumber(raw.serviceCharge),
    totalAmount: toNumber(raw.totalAmount),
    taxBreakdown: raw.taxBreakdown ?? [],
    discountTotal: toNumber(raw.discountTotal),
    discounts: raw.discounts ?? [],
    notes: raw.notes ?? "",
    items: items.map(({ id, menuItemId, quantity, price, name }) => ({
      id,
      orderId: "",
      menuItemId,
      quantity,
      price,
      name,
    })),
    createdAt: toDate(raw.createdAt),
    acceptedAt: raw.acceptedAt ? new Date(raw.acceptedAt) : null,
    preparingAt: raw.preparingAt ? new Date(raw.preparingAt) : null,
    readyAt: raw.readyAt ? new Date(raw.readyAt) : null,
    servedAt: raw.servedAt ? new Date(raw.servedAt) : null,
    cancelledAt: raw.cancelledAt ? new Date(raw.cancelledAt) : null,
    meta: isRecord(raw.meta) ? (raw.meta as NewOrderMeta) : undefined,
  };
};

/**
 * The staff surfaces (kitchen board, order detail) need the per-item fields the
 * public `Order` drops.
 *
 * Kept separate from `mapRawOrder` rather than merged, so the customer-facing
 * tracking page does not carry fields it never reads.
 */
export const mapRawOrderForStaff = (
  raw: RawOrder
): Order & { items?: StaffOrderItem[] } => {
  const base = mapRawOrder(raw);
  const { tableId, table } = readTableRef(raw.tableId);
  const rawStatus = String(raw.status ?? "pending");
  return {
    ...base,
    tableId,
    table,
    items: (raw.items ?? []).map((item, idx) => mapRawOrderItem(item, idx, rawStatus)),
  };
};

export const mapRawOrders = (raw: RawOrder[]): Order[] => raw.map(mapRawOrder);

// ── Waiter request ───────────────────────────────────────────────────────────

export const mapRawWaiterRequest = (raw: RawWaiterRequest): WaiterRequest => {
  const { tableId, table } = readTableRef(raw.tableId);
  return {
    id: raw._id ?? "",
    tableId,
    table,
    requestType: raw.requestType || "Assistance Requested",
    status: toRequestStatus(raw.status),
    createdAt: toDate(raw.createdAt),
  };
};

// ── Menu ─────────────────────────────────────────────────────────────────────

export const mapRawCategory = (raw: RawCategory): MenuCategory => ({
  id: raw._id,
  name: raw.name,
  displayOrder: toNumber(raw.displayOrder),
});

const mapRawVariants = (raw: RawMenuVariant[] = []): MenuVariant[] =>
  raw.map((v) => ({
    _id: v._id,
    name: v.name,
    price: toNumber(v.price),
    isDefault: v.isDefault,
  }));

const mapRawModifierGroups = (
  raw: RawMenuModifierGroup[] = []
): MenuModifierGroup[] =>
  raw.map((g) => ({
    _id: g._id,
    name: g.name,
    selectionType: g.selectionType,
    isRequired: g.isRequired,
    min: g.min,
    max: g.max,
    options: (g.options ?? []).map(
      (o): MenuModifierOption => ({
        _id: o._id,
        name: o.name,
        price: toNumber(o.price),
        isDefault: o.isDefault,
      })
    ),
  }));

/**
 * A menu item, optionally linked to its category.
 *
 * `featured`, `preparationTime` and `prepMinutes` are not in the schema — the
 * admin page invented them as placeholders (`false`, `10`). They are kept as
 * defaults here so every surface stops inventing its own, and so adding the
 * columns later is a change in one place.
 */
export const mapRawMenuItem = (
  raw: RawMenuItem,
  category?: MenuCategory
): MenuItem => ({
  id: raw._id,
  categoryId: raw.categoryId,
  category,
  name: raw.name,
  description: raw.description ?? "",
  imageUrl: raw.image || null,
  price: toNumber(raw.price),
  gstPercentage: toNumber(raw.gstPercentage),
  available: raw.isAvailable ?? true,
  featured: false,
  preparationTime: 10,
  variants: mapRawVariants(raw.variants),
  modifierGroups: mapRawModifierGroups(raw.modifierGroups),
  dietaryTags: raw.dietaryTags ?? [],
  ingredients: raw.ingredients ?? [],
  allergens: raw.allergens ?? [],
  calories: toNumber(raw.calories),
  prepStation: raw.prepStation ?? "kitchen",
});

export const asRawCategories = (value: unknown): RawCategory[] =>
  Array.isArray(value) ? (value as RawCategory[]) : [];

export const asRawMenuItems = (value: unknown): RawMenuItem[] =>
  Array.isArray(value) ? (value as RawMenuItem[]) : [];

// ── Untrusted input ──────────────────────────────────────────────────────────

/**
 * Assert that a socket payload is a usable order.
 *
 * The four `new-order` listeners previously accepted `any`, so a malformed or
 * hostile payload reached the mapper and produced an order with `id: undefined`
 * that React would then render as a key collision. A socket message is
 * untrusted input, exactly like a request body, so it is checked here once.
 */
export const asRawOrderPayload = (value: unknown): RawOrderSocketPayload | null =>
  isRecord(value) ? (value as unknown as RawOrderSocketPayload) : null;

/** Assert a `{ orderId, status }` socket payload. */
export const asOrderStatusPayload = (value: unknown): OrderStatusEventPayload | null =>
  isRecord(value) && typeof value.orderId === "string" && typeof value.status === "string"
    ? { orderId: value.orderId, status: value.status }
    : null;

/** Assert a `{ orderId, itemId, status }` KDS payload. */
export const asKdsItemPayload = (value: unknown): KdsItemUpdatedPayload | null =>
  isRecord(value) &&
  typeof value.orderId === "string" &&
  typeof value.itemId === "string" &&
  typeof value.status === "string"
    ? { orderId: value.orderId, itemId: value.itemId, status: value.status }
    : null;

export const asRawOrders = (value: unknown): RawOrder[] =>
  Array.isArray(value) ? (value as RawOrder[]) : [];

export const asRawWaiterRequests = (value: unknown): RawWaiterRequest[] =>
  Array.isArray(value) ? (value as RawWaiterRequest[]) : [];

/**
 * Assert a single `waiter-request-created` socket payload.
 *
 * Returns `null` unless it looks like a request document — the socket is
 * untrusted input, and mapping a malformed payload produced a card keyed on
 * `undefined`, which React silently collided with every other bad card.
 */
export const asRawWaiterRequest = (value: unknown): RawWaiterRequest | null =>
  isRecord(value) && typeof value._id === "string"
    ? (value as unknown as RawWaiterRequest)
    : null;

/** Assert a `{ id }` socket payload used to remove a resolved request. */
export const asIdPayload = (value: unknown): { id: string } | null =>
  isRecord(value) && typeof value.id === "string" ? { id: value.id } : null;

export { asString };