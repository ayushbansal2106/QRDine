# QRDine Development Guide

## Project Overview

QRDine is a multi-tenant SaaS platform for QR-based digital ordering in cafes and restaurants. Customers scan QR codes to browse menus and place orders; staff manage orders in real-time via an admin dashboard.

## Repository Structure

```
QRDine/
├── frontend/           # Next.js 16 + React 19 + TypeScript + Tailwind CSS
├── backend/            # Node.js + Express + MongoDB + Socket.IO
├── docs/               # PRD, TDD, MongoDB setup, devlog
└── DESIGN.md           # Design system specification
```

## Quick Start

### Development Setup

```bash
# Backend
cd backend
npm install
npm run dev    # Starts on port 5000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev    # Starts on port 3000
```

### Required Environment Variables

**Backend (.env)**:
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - Secret for signing JWT tokens
- `FRONTEND_URL` - Frontend origin for CORS (default: http://localhost:3000)
- `CLOUDINARY_*` - Image upload credentials (optional)
- `SMTP_*` - Email credentials (optional)

**Frontend (.env)**:
- `NEXT_PUBLIC_API_URL` - Backend API URL (default: http://127.0.0.1:5000/api)

## Architecture

### Multi-Tenant Data Model

**All business entities belong to a cafe.** Every MongoDB collection includes `cafeId` for tenant isolation:

- `Cafe` - Tenant root entity
- `User` - Admins (roles: owner, manager, staff) linked to cafe
- `Category` - Menu categories
- `MenuItem` - Food items with pricing
- `Table` - Physical tables with QR codes
- `Order` - Customer orders
- `WaiterRequest` - Assistance requests
- `DiningSession` - Tracks active dining periods (Sprint 7.5)

### Data Flow

**Customer Order Flow:**
1. Customer scans table QR → identifies `tableId`
2. Creates `DiningSession` (gets `sessionId`)
3. Browsing menu via `GET /api/menu`
4. Places order via `POST /api/orders` with `sessionId`
5. Socket emits `new-order` to `cafe-{cafeId}` room
6. Admin dashboard receives real-time update

**Admin Order Flow:**
1. Login via `POST /api/auth/login` → JWT in cookie
2. Protected routes use `protect` + `tenantMiddleware`
3. `tenantMiddleware` injects `req.cafeId` from `req.user.cafeId`
4. All queries filter by `cafeId`

## Backend Patterns

### MVC Structure

```
src/
├── controllers/    # Request handlers with asyncHandler
├── routes/         # Express routers with middleware
├── models/         # Mongoose schemas with indexes
├── middlewares/    # auth, tenant, error, rate-limit
├── services/       # Business logic (socket, email, invoice)
├── utils/          # AppError, asyncHandler, helpers
├── config/         # env, db configuration
└── docs/           # swaggerSpec
```

### Route Protection Pattern

```javascript
const router = express.Router();

// Public endpoints
router.post('/', validatePayload, controller.create);

// Protected: requires valid JWT + cafe context + role
router.use(protect, tenantMiddleware, authorizeRoles('owner', 'manager'));
router.get('/', controller.getAll);
router.put('/:id', controller.update);
```

### Error Handling

- Use `AppError` for expected errors
- Wrap all async controllers with `asyncHandler`
- `errorHandler` middleware handles JWT, validation, duplicate key errors

### Socket.IO Rooms

- `cafe-{cafeId}` - Admin dashboard listeners
- `order-{orderId}` - Customer tracking page
- `session-{sessionId}` - Group order collaboration
- Events: `new-order`, `order-updated`, `waiter-request-created`, `session-activity`

## Frontend Patterns

### App Router Structure

```
src/app/
├── admin/(dashboard)/  # Protected admin routes
├── table/[tableId]/    # Customer menu (public)
├── cart/             # Cart page
├── order/[orderId]/  # Order tracking
└── (other pages)
```

### Authentication

- Admin token stored in `admin_token` cookie
- Middleware in `src/middleware.ts` protects `/admin/*` routes
- Redirects to `/admin/login` when unauthenticated

### State Management

- **Zustand** with `persist` middleware for cart state
- **Socket store** for real-time connection management
- **Session store** for dining session context

### API Client

- `src/lib/apiClient.ts` - Axios instance with auto JWT injection
- **Server Actions** in `src/actions/*.ts` for data mutations with `revalidatePath`
- Never trust frontend prices: backend validates menu items and recalculates totals

### Socket Client

- `src/lib/socket.ts` - Socket.IO client wrapper
- Connects to backend for real-time updates
- Auto-reconnect with exponential backoff

## Code Conventions

### Backend (JavaScript)

- CommonJS modules (`require`/`module.exports`)
- Async/await with `asyncHandler` wrapper
- Error-first callbacks avoided; use throw/catch
- Tenant isolation via `req.cafeId` from `tenantMiddleware`

### Frontend (TypeScript)

- TypeScript with strict mode
- Tailwind CSS utility classes
- `@/` alias for `src/` imports
- Server Actions for mutations with proper error handling
- Material Symbols icon font for icons

### Naming

- Models: PascalCase (e.g., `Order`, `MenuItem`)
- Routes: kebab-case in URLs (e.g., `/api/menu-items`)
- Components: PascalCase with semantic names (e.g., `FoodCard`, `OrderStatusTracker`)

## Database Indexes

Every query includes `cafeId` as the first index field for tenant isolation:

```javascript
// Example: orders collection
orderSchema.index({ cafeId: 1 });
orderSchema.index({ cafeId: 1, tableId: 1 });
orderSchema.index({ cafeId: 1, status: 1, createdAt: -1 });
```

## Security Gotchas

1. **Never trust frontend prices** - Backend always validates menu items and recalculates `subtotal`, `totalGST`, `totalAmount`
2. **Guest tokens required** for session operations - validate `x-guest-token` header against `session.guestToken`
3. **Idempotency** - Orders support `clientRequestId` to prevent duplicate submissions
4. **Rate limiting** - Express rate limiter configured in `src/middlewares/rateLimiter.js`

## Common Tasks

### Adding a New Protected Endpoint

1. Create controller in `src/controllers/`
2. Add validation middleware if needed in `src/middlewares/`
3. Register route in `src/routes/[resource]Routes.js`
4. Apply `protect`, `tenantMiddleware`, `authorizeRoles` middlewares

### Adding a Customer-Facing Endpoint

1. No auth middleware required
2. Still validate tenant context where applicable (e.g., table belongs to cafe)
3. Use `x-guest-token` header for session-scoped operations

### Adding Real-Time Event

1. Define emit function in `src/services/socketService.js`
2. Call from controller after state change
3. Listen in frontend component via `socketStore` or direct socket connection

## Testing

No test suite configured yet. Backend `npm test` exits with error message.

## Build & Deploy

### Frontend
```bash
npm run build    # Next.js production build
npm run start    # Serve production build
npm run lint     # ESLint (v9)
```

### Backend
No build step; runs directly with Node.js.

## Key Files Reference

- `backend/src/models/*.js` - All Mongoose schemas
- `backend/src/services/socketService.js` - Socket event definitions
- `frontend/src/types/index.ts` - TypeScript types
- `frontend/src/lib/apiClient.ts` - Authenticated axios instance
- `frontend/src/store/*.ts` - Zustand stores
- `frontend/src/middleware.ts` - Route protection rules
- `DESIGN.md` - Design tokens (colors, typography, spacing)