# **QRDine Technical Design Document (TDD)**

## **Version**

1.0 MVP

## **Project Type**

Multi-Tenant SaaS Platform

## **Architecture Pattern**

Client (React)  
     │  
     ▼  
REST API \+ Socket.IO  
     │  
     ▼  
Node.js \+ Express  
     │  
     ▼  
MongoDB Atlas  
---

# **1\. System Architecture**

## **Customer Flow**

Customer  
  │  
Scan QR  
  │  
Open Menu  
  │  
Add Items  
  │  
Place Order  
  │  
Backend Creates Order  
  │  
Socket Event Triggered  
  │  
Admin Receives Order  
---

## **Admin Flow**

Admin Login  
  │  
Dashboard  
  │  
Receive Order  
  │  
Update Status  
  │  
Socket Event Triggered  
  │  
Customer Sees Updated Status  
---

# **2\. Technology Stack**

## **Frontend**

React  
Vite  
Tailwind CSS  
React Router  
Axios  
Socket.IO Client  
---

## **Backend**

Node.js  
Express.js  
Socket.IO  
JWT  
bcrypt  
---

## **Database**

MongoDB Atlas  
Mongoose  
---

## **Deployment**

Frontend → Vercel

Backend → Render

Database → MongoDB Atlas  
---

# **3\. Folder Structure**

## **Frontend**

frontend/

src/

components/  
layouts/  
pages/  
hooks/  
contexts/  
services/  
utils/

pages/

customer/  
admin/

App.jsx  
main.jsx  
---

## **Backend**

backend/

src/

controllers/  
routes/  
models/  
middlewares/  
services/  
sockets/  
utils/  
config/

server.js  
---

# **4\. Multi-Tenant Strategy**

This is the most important part.

Every record must belong to a cafe.

Every collection includes:

cafeId

Example:

MenuItem {  
 cafeId  
}  
Order {  
 cafeId  
}  
Table {  
 cafeId  
}

This allows:

Cafe A  
Cafe B  
Cafe C

to use the same platform.

---

# **5\. Database Design**

---

## **Cafe Schema**

{  
 \_id,

 name,

 logo,

 address,

 phone,

 email,

 createdAt  
}  
---

## **User Schema**

{  
 \_id,

 cafeId,

 name,

 email,

 password,

 role,

 createdAt  
}

Role:

owner  
manager  
staff  
---

## **Category Schema**

{  
 \_id,

 cafeId,

 name,

 displayOrder  
}  
---

## **Menu Item Schema**

{  
 \_id,

 cafeId,

 categoryId,

 name,

 description,

 image,

 price,

 isAvailable,

 createdAt  
}  
---

## **Table Schema**

{  
 \_id,

 cafeId,

 tableNumber,

 qrCodeUrl,

 isActive  
}  
---

## **Order Schema**

{  
 \_id,

 cafeId,

 tableId,

 orderNumber,

 items: \[\],

 totalAmount,

 status,

 createdAt  
}

Status:

pending  
preparing  
ready  
served  
cancelled  
---

## **Order Item Schema**

{  
 menuItemId,

 itemName,

 quantity,

 price  
}  
---

## **Waiter Request Schema**

{  
 \_id,

 cafeId,

 tableId,

 requestType,

 message,

 status,

 createdAt  
}  
---

# **6\. Authentication Design**

## **Admin Login**

Email  
Password  
---

Backend:

POST /auth/login  
---

Returns:

{  
 token,  
 user  
}  
---

Protected Routes:

/admin/\*

Require:

Bearer Token  
---

# **7\. API Design**

---

## **Auth APIs**

### **Login**

POST /api/auth/login  
---

## **Cafe APIs**

### **Get Cafe**

GET /api/cafe  
---

### **Update Cafe**

PUT /api/cafe  
---

## **Categories**

### **Get Categories**

GET /api/categories  
---

### **Create Category**

POST /api/categories  
---

### **Delete Category**

DELETE /api/categories/:id  
---

## **Menu APIs**

### **Get Menu**

GET /api/menu  
---

### **Create Item**

POST /api/menu  
---

### **Update Item**

PUT /api/menu/:id  
---

### **Delete Item**

DELETE /api/menu/:id  
---

## **Table APIs**

### **Get Tables**

GET /api/tables  
---

### **Create Table**

POST /api/tables  
---

### **Delete Table**

DELETE /api/tables/:id  
---

## **Order APIs**

### **Create Order**

POST /api/orders

Customer API

---

### **Get Orders**

GET /api/orders

Admin API

---

### **Get Single Order**

GET /api/orders/:id  
---

### **Update Status**

PATCH /api/orders/:id/status  
---

## **Waiter Request APIs**

### **Create Request**

POST /api/waiter-request  
---

### **Get Requests**

GET /api/waiter-request  
---

### **Resolve Request**

PATCH /api/waiter-request/:id  
---

# **8\. Socket.IO Design**

---

## **Event: New Order**

Triggered when:

Customer Places Order

Emit:

newOrder

Admin dashboard receives instantly.

---

## **Event: Order Updated**

Triggered when:

Admin Changes Status

Emit:

orderUpdated

Customer tracking screen updates.

---

## **Event: Waiter Request**

Triggered when:

Customer Presses Call Waiter

Emit:

waiterRequestCreated

Admin receives notification.

---

# **9\. QR System Design**

Each table gets:

/table/1  
/table/2  
/table/3

Full URL:

qrdine.com/cafe/demo/table/1

QR code generated automatically.

---

# **10\. MVP Build Sequence**

Do NOT build randomly.

### **Sprint 1**

Project Setup  
MongoDB Connection  
Folder Structure

### **Sprint 2**

Authentication  
JWT  
Protected Routes

### **Sprint 3**

Cafe  
Category  
Menu Models  
CRUD APIs

### **Sprint 4**

Tables  
QR Generation

### **Sprint 5**

Customer Menu  
Cart  
Order Creation

### **Sprint 6**

Orders Dashboard  
Status Updates

### **Sprint 7**

Socket.IO  
Realtime Updates

### **Sprint 8**

Waiter Requests  
Deployment  
Demo Data  
