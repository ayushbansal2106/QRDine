# **QRDine MVP – Corrected Implementation Plan (Next.js 15\)**

## **Project Goal**

Build a production-ready MVP of QRDine using the existing Stitch design as the visual source of truth.

The application must recreate the Stitch UI exactly while implementing dynamic functionality using Next.js 15, React, TypeScript, Prisma, PostgreSQL, Zustand, JWT Authentication, and Socket.io.

No static HTML pages should remain in the final implementation.

---

# **Technology Stack**

## **Frontend**

* Next.js 15  
* React 19  
* TypeScript  
* Tailwind CSS  
* Shadcn UI

## **State Management**

* Zustand

## **Database**

* PostgreSQL  
* Prisma ORM

## **Authentication**

* JWT Authentication  
* HttpOnly Cookies

## **Real-Time Communication**

* Socket.io

## **Deployment**

* Vercel (Frontend)  
* Neon PostgreSQL

---

# **Design Requirements**

The Stitch design named "Smart QR Cafe Menu" is the source of truth.

Requirements:

* Preserve layout exactly  
* Preserve colors exactly  
* Preserve spacing exactly  
* Preserve typography exactly  
* Preserve border radius exactly  
* Preserve shadows exactly  
* Preserve responsiveness exactly

Do not redesign any screens.

Generate a DESIGN.md file from the Stitch project and use it throughout development.

---

# **Directory Structure**

frontend/src/

app/

layout.tsx

page.tsx

table/

\[tableId\]/

page.tsx

cart/

page.tsx

checkout/

page.tsx

order/

success/

\[orderId\]/

page.tsx

\[orderId\]/

page.tsx

admin/

layout.tsx

login/

page.tsx

orders/

page.tsx

\[id\]/

page.tsx

menu/

page.tsx

tables/

page.tsx

requests/

page.tsx

qr/

page.tsx

settings/

page.tsx

api/

auth/

login/

logout/

menu/

orders/

tables/

requests/

components/

layout/

TopAppBar.tsx

AdminSidebar.tsx

navigation/

CategoryTabs.tsx

SearchBar.tsx

menu/

FoodCard.tsx

QuantityStepper.tsx

cart/

CartItem.tsx

BottomCartSummary.tsx

checkout/

CheckoutSummary.tsx

order/

OrderStatusTracker.tsx

admin/

OrderStatusColumn.tsx

OrderTicket.tsx

TableCard.tsx

QRPreviewCard.tsx

common/

LoadingSkeleton.tsx

EmptyState.tsx

Modal.tsx

Button.tsx

store/

cartStore.ts

socketStore.ts

lib/

prisma.ts

auth.ts

socket.ts

utils.ts

actions/

menu.ts

orders.ts

tables.ts

requests.ts

types/

index.ts

prisma/

schema.prisma

middleware.ts

---

# **Database Schema**

## **Admin**

* id  
* email  
* passwordHash  
* role  
* createdAt

## **Table**

* id  
* tableNumber  
* qrCodeUrl  
* status  
* createdAt

## **MenuCategory**

* id  
* name  
* displayOrder

## **MenuItem**

* id  
* categoryId  
* name  
* description  
* image  
* price  
* available  
* preparationTime

## **Order**

* id  
* tableId  
* status  
* totalAmount  
* notes  
* createdAt

## **OrderItem**

* id  
* orderId  
* menuItemId  
* quantity  
* price

## **WaiterRequest**

* id  
* tableId  
* requestType  
* status  
* createdAt

---

# **State Management**

Use Zustand.

## **Cart Store**

Functions:

* addItem()  
* removeItem()  
* updateQuantity()  
* clearCart()  
* getTotalItems()  
* getTotalPrice()

Persist cart in localStorage.

## **Socket Store**

Functions:

* connect()  
* disconnect()  
* subscribeToOrder()  
* subscribeToRequests()

---

# **Authentication**

Use JWT Authentication.

Store JWT in HttpOnly Cookie.

Protected Routes:

* /admin/\*  
* menu management  
* order management  
* qr management  
* table management

Use middleware.ts to enforce protection.

---

# **Real-Time Events**

Socket Events:

## **Customer**

* order-created  
* order-updated  
* order-ready  
* waiter-response

## **Admin**

* new-order  
* status-change  
* waiter-request  
* table-status-change

---

# **Customer Application**

## **Menu Page**

Route:

/table/\[tableId\]

Features:

* Category navigation  
* Search menu  
* View menu items  
* Add to cart  
* Quantity adjustment  
* Call waiter

---

## **Cart Page**

Route:

/cart

Features:

* Review items  
* Update quantities  
* Remove products  
* Special instructions  
* Price calculation

---

## **Checkout Page**

Route:

/checkout

Features:

* Order summary  
* Notes  
* Confirm order

---

## **Success Page**

Route:

/order/success/\[orderId\]

Features:

* Confirmation message  
* Order details  
* Tracking button

---

## **Order Tracking**

Route:

/order/\[orderId\]

Features:

* Live status updates  
* Socket connection  
* Progress indicator

Statuses:

Pending

Accepted

Preparing

Ready

Served

---

# **Admin Dashboard**

## **Login**

/admin/login

Features:

* Email login  
* JWT generation

---

## **Orders Dashboard**

/admin/orders

Features:

* Kanban board  
* Real-time updates  
* Status drag and drop

Columns:

Pending

Accepted

Preparing

Ready

Served

---

## **Order Detail**

/admin/orders/\[id\]

Features:

* Order details  
* Update status  
* Print ticket

---

## **Menu Management**

/admin/menu

Features:

* Create item  
* Edit item  
* Disable item  
* Delete item

---

## **Table Management**

/admin/tables

Features:

* View tables  
* Occupancy status  
* QR assignment

---

## **QR Management**

/admin/qr

Features:

* QR preview  
* Download QR  
* Reassign QR

---

## **Waiter Requests**

/admin/requests

Features:

* Active requests  
* Resolve requests

---

# **Server Actions**

Use Next.js Server Actions wherever possible.

Examples:

* createMenuItem()  
* updateMenuItem()  
* createOrder()  
* updateOrderStatus()  
* createWaiterRequest()  
* updateTableStatus()

Avoid unnecessary REST APIs.

---

# **Reusable Components**

Required Components:

* TopAppBar  
* AdminSidebar  
* CategoryTabs  
* SearchBar  
* FoodCard  
* QuantityStepper  
* CartItem  
* BottomCartSummary  
* CheckoutSummary  
* OrderStatusTracker  
* OrderStatusColumn  
* OrderTicket  
* TableCard  
* QRPreviewCard  
* LoadingSkeleton  
* EmptyState  
* Modal  
* Button

---

# **Quality Standards**

Requirements:

* Strict TypeScript  
* ESLint clean  
* No duplicated code  
* Mobile-first design  
* Responsive layouts  
* Accessibility support  
* Reusable components  
* Proper loading states  
* Proper error handling

---

# **Verification Plan**

## **Build Validation**

Run:

npm run build

Build must complete without warnings or errors.

---

## **Manual Testing**

Customer Flow:

1. Scan QR  
2. Open table menu  
3. Add products  
4. Checkout  
5. Place order  
6. Track order

Admin Flow:

1. Login  
2. Receive order  
3. Update status  
4. Verify customer receives updates

Waiter Flow:

1. Customer requests assistance  
2. Admin receives request  
3. Resolve request

---

# **MVP Scope (Hackathon Version)**

Must Have:

* QR Table Routing  
* Digital Menu  
* Cart  
* Checkout  
* Order Tracking  
* Admin Orders Dashboard  
* Waiter Requests  
* Real-Time Updates

Optional After MVP:

* Analytics  
* Payments  
* Kitchen Dashboard  
* Loyalty Program  
* Multi-Branch Support

