# **Product Requirements Document (PRD)**

## **Product Name**

QRDine

## **Version**

MVP v1.0

## **Product Overview**

QRDine is a QR-based digital ordering and table management platform designed for cafes, restaurants, food courts, and college canteens.

Customers scan a QR code placed on their table, browse the digital menu, place orders directly from their phone, and request assistance without waiting for staff.

Restaurant staff receive orders in real-time through an admin dashboard and manage the order lifecycle from preparation to serving.

The objective of the MVP is to reduce manual ordering efforts while improving customer experience and operational efficiency.

---

# **Problem Statement**

Many small and medium-sized cafes still rely on manual order-taking methods.

Current challenges:

* Waiters manually record orders.  
* Order communication delays occur.  
* Human errors happen while taking orders.  
* Customers wait to place additional orders.  
* Menu updates require reprinting.  
* No centralized digital ordering workflow exists.

QRDine aims to digitize the ordering process without requiring customers to install any application.

---

# **Goals**

## **Business Goals**

* Acquire first pilot cafe.  
* Validate market demand.  
* Create a scalable SaaS foundation.  
* Demonstrate business value to restaurant owners.

## **User Goals**

Customer:

* View menu instantly.  
* Place orders quickly.  
* Request assistance easily.

Restaurant Owner:

* Receive orders digitally.  
* Manage menu without developers.  
* Track order status in real time.

---

# **Target Users**

## **Primary Users**

### **Customers**

People visiting cafes and restaurants.

### **Restaurant Staff**

Cashiers, managers, reception staff.

### **Restaurant Owners**

Business owners managing operations.

---

# **Scope**

## **Included In MVP**

### **Customer Portal**

* Scan QR code  
* View menu  
* Browse categories  
* Add items to cart  
* Update quantities  
* Place order  
* View order confirmation  
* Request waiter assistance

### **Admin Dashboard**

* Secure login  
* Manage menu categories  
* Add menu items  
* Edit menu items  
* Delete menu items  
* Upload item images  
* View incoming orders  
* Update order status  
* Manage tables  
* Generate table QR codes

### **System Features**

* Multi-tenant architecture  
* Real-time order updates  
* Mobile responsive UI  
* QR-based table identification

---

## **Excluded From MVP**

The following features are intentionally excluded:

* Online payments  
* Loyalty points  
* Coupons  
* Inventory management  
* Kitchen display system  
* Analytics dashboard  
* Customer accounts  
* Push notifications  
* GST billing  
* Employee management  
* AI recommendations  
* Google Review rewards

These features may be added in future versions.

---

# **User Flow**

## **Customer Flow**

1. Customer scans table QR code.  
2. System identifies table number.  
3. Customer views menu.  
4. Customer adds items to cart.  
5. Customer places order.  
6. Order reaches admin dashboard.  
7. Restaurant prepares food.  
8. Staff updates status.  
9. Customer receives food.  
10. Customer may place additional orders.

---

## **Admin Flow**

1. Admin logs in.  
2. Dashboard displays active orders.  
3. New order appears instantly.  
4. Admin changes status:  
   * Pending  
   * Preparing  
   * Ready  
   * Served  
5. Admin manages menu and tables.

---

# **Functional Requirements**

## **FR-01 QR Access**

The system shall generate a unique QR code for every table.

Example:

/cafe/123/table/5

Scanning the QR automatically identifies the table.

---

## **FR-02 Menu Management**

Admin shall:

* Create categories  
* Add items  
* Upload images  
* Set prices  
* Edit items  
* Remove items

---

## **FR-03 Cart Management**

Customer shall:

* Add item  
* Remove item  
* Increase quantity  
* Decrease quantity

---

## **FR-04 Order Placement**

Customer shall place an order without account creation.

Order data includes:

* Table Number  
* Items  
* Quantity  
* Timestamp  
* Status

---

## **FR-05 Live Orders Dashboard**

Admin shall view all incoming orders in real time.

Displayed fields:

* Order ID  
* Table Number  
* Items  
* Total Amount  
* Status

---

## **FR-06 Order Status Management**

Admin shall update order status.

Available statuses:

* Pending  
* Preparing  
* Ready  
* Served

---

## **FR-07 Call Waiter**

Customer can request staff assistance.

Request appears instantly on dashboard.

---

## **FR-08 Table Management**

Admin shall:

* Add table  
* Remove table  
* Generate QR  
* Download QR

---

# **Non-Functional Requirements**

## **Performance**

* Menu load time under 2 seconds.  
* Order creation under 1 second.  
* Dashboard updates in real time.

## **Security**

* JWT Authentication.  
* Password hashing using bcrypt.  
* Protected admin routes.

## **Reliability**

* 99% uptime target.  
* Automatic error logging.

## **Scalability**

System should support:

* Multiple cafes  
* 100+ tables per cafe  
* 500+ daily orders

---

# **Database Design**

Cafe

* id  
* name  
* logo  
* address  
* ownerEmail

Table

* id  
* cafeId  
* tableNumber  
* qrCode

Category

* id  
* cafeId  
* name

MenuItem

* id  
* cafeId  
* categoryId  
* name  
* description  
* image  
* price  
* isAvailable

Order

* id  
* cafeId  
* tableId  
* items  
* totalAmount  
* status  
* createdAt

WaiterRequest

* id  
* cafeId  
* tableId  
* status  
* createdAt

User

* id  
* cafeId  
* name  
* email  
* password

---

# **Technology Stack**

Frontend:

* React.js  
* Tailwind CSS

Backend:

* Node.js  
* Express.js

Database:

* MongoDB

Authentication:

* JWT

Real-Time Communication:

* Socket.IO

Hosting:

* Vercel (Frontend)  
* Render/Railway (Backend)  
* MongoDB Atlas

---

# **Success Metrics**

Pilot Success Criteria:

* 1 cafe actively using the system.  
* 50+ orders processed.  
* Order placement time reduced.  
* Positive feedback from owner.

Business Success Criteria:

* First paying customer.  
* Second cafe onboarded without code changes.  
* Monthly recurring revenue initiated.

---

# **Future Roadmap**

Version 2:

* Online Payments  
* Google Review Rewards  
* Basic Analytics

Version 3:

* Kitchen Display System  
* Inventory Tracking  
* Customer Loyalty Program

Version 4:

* AI-Based Recommendations  
* Sales Forecasting  
* Multi-Branch Support

