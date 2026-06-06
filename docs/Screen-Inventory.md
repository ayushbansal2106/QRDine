# **CUSTOMER APP**

## **Screen 1: Menu Page**

### **Route**

/table/:tableId

### **Purpose**

Allow customers to browse menu and add items to cart.

### **Components**

* Cafe Logo  
* Cafe Name  
* Table Number Badge  
* Search Bar  
* Category Tabs  
* Food Cards  
* Add To Cart Button  
* Floating Call Waiter Button  
* Sticky Cart Summary

### **Actions**

* Search Items  
* Filter Category  
* Add Item  
* Open Cart  
* Call Waiter

### **APIs**

GET /api/menu  
GET /api/categories

### **Data Needed**

MenuItem {  
name  
description  
image  
price  
category  
isAvailable  
}  
---

# **Screen 2: Cart Page**

### **Route**

/cart

### **Purpose**

Review items before placing order.

### **Components**

* Cart Items  
* Quantity Controls  
* Remove Item  
* Price Breakdown  
* Total Amount  
* Place Order Button

### **Actions**

* Increase Quantity  
* Decrease Quantity  
* Remove Item  
* Place Order

### **APIs**

POST /api/orders

### **Data Needed**

CartItem {  
itemId  
quantity  
price  
}  
---

# **Screen 3: Order Success**

### **Route**

/order/success/:orderId

### **Purpose**

Confirm order placement.

### **Components**

* Success Animation  
* Order ID  
* Table Number  
* Ordered Items  
* Estimated Time  
* Track Order Button  
* Order More Button

### **Actions**

* Track Order  
* Return To Menu

### **APIs**

GET /api/orders/:id  
---

# **Screen 4: Track Order**

### **Route**

/order/:orderId

### **Purpose**

Show order progress.

### **Components**

* Order ID  
* Progress Timeline  
* Current Status  
* Estimated Time  
* Support Button

### **Statuses**

Pending  
Preparing  
Ready  
Served

### **APIs**

GET /api/orders/:id

Realtime:

Socket.IO  
orderUpdated  
---

# **Screen 5: Call Waiter Modal**

### **Purpose**

Request assistance.

### **Components**

* Need Water  
* Need Bill  
* Need Assistance  
* Custom Message  
* Submit Button

### **Actions**

* Send Request

### **APIs**

POST /api/waiter-request  
---

# **ADMIN DASHBOARD**

---

# **Screen 6: Login**

### **Route**

/admin/login

### **Purpose**

Authenticate staff.

### **Components**

* Email  
* Password  
* Login Button

### **APIs**

POST /api/auth/login

### **Data Needed**

User {  
email  
password  
role  
}  
---

# **Screen 7: Orders Dashboard**

### **Route**

/admin/orders

### **Purpose**

Manage incoming orders.

### **Components**

* Sidebar  
* Order Cards  
* Status Columns  
* Notifications

### **Actions**

* Accept Order  
* Mark Preparing  
* Mark Ready  
* Mark Served

### **APIs**

GET /api/orders  
PATCH /api/orders/:id/status

### **Data Needed**

Order {  
orderId  
tableNumber  
items  
totalAmount  
status  
createdAt  
}  
---

# **Screen 8: Order Details**

### **Route**

/admin/orders/:id

### **Purpose**

View complete order.

### **Components**

* Table Number  
* Ordered Items  
* Quantity  
* Total  
* Status Controls

### **APIs**

GET /api/orders/:id  
PATCH /api/orders/:id/status  
---

# **Screen 9: Menu Management**

### **Route**

/admin/menu

### **Purpose**

Manage menu.

### **Components**

* Categories  
* Menu Table  
* Add Item  
* Edit Item  
* Delete Item  
* Availability Toggle

### **Actions**

* Create Item  
* Update Item  
* Delete Item

### **APIs**

GET /api/menu  
POST /api/menu  
PUT /api/menu/:id  
DELETE /api/menu/:id  
---

# **Screen 10: Add/Edit Menu Item Modal**

### **Fields**

Item Name  
Description  
Price  
Category  
Image  
Available

### **APIs**

POST /api/menu  
PUT /api/menu/:id  
---

# **Screen 11: Category Management**

### **Purpose**

Manage categories.

### **Components**

* Category List  
* Add Category  
* Delete Category

### **APIs**

GET /api/categories  
POST /api/categories  
DELETE /api/categories/:id  
---

# **Screen 12: Table Management**

### **Route**

/admin/tables

### **Purpose**

Manage restaurant tables.

### **Components**

* Table List  
* Add Table  
* Delete Table  
* QR Preview

### **APIs**

GET /api/tables  
POST /api/tables  
DELETE /api/tables/:id  
---

# **Screen 13: QR Management**

### **Route**

/admin/qr

### **Purpose**

Generate table QR codes.

### **Components**

* QR Preview  
* Download QR  
* Print QR

### **APIs**

GET /api/tables  
---

# **Screen 14: Waiter Requests**

### **Route**

/admin/requests

### **Purpose**

View customer assistance requests.

### **Components**

* Table Number  
* Request Type  
* Time  
* Resolve Button

### **APIs**

GET /api/waiter-request  
PATCH /api/waiter-request/:id  
---

# **Screen 15: Cafe Settings**

### **Route**

/admin/settings

### **Purpose**

Configure cafe.

### **Components**

* Cafe Name  
* Logo Upload  
* Address  
* Phone Number  
* Opening Hours

### **APIs**

GET /api/cafe  
PUT /api/cafe  
---

# **Backend Models Discovered**

After inventory, we know we need:

Cafe  
User  
Category  
MenuItem  
Table  
Order  
OrderItem  
WaiterRequest  
---

# **Socket Events Needed**

newOrder

orderUpdated

waiterRequestCreated

waiterRequestResolved  
---

# **MVP Build Order (Very Important)**

Build in this order:

1\. Authentication

2\. Cafe

3\. Categories

4\. Menu Items

5\. Tables

6\. QR Generation

7\. Cart

8\. Orders

9\. Order Dashboard

10\. Socket.IO

11\. Waiter Requests

12\. Deployment  
