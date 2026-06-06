# QRDine Development Log

## Sprint 1 – Backend Foundation

### Date

2026-06-07

### Goal

Establish a scalable multi-tenant SaaS backend foundation.

### Completed

* Express.js backend setup
* MongoDB Atlas integration
* Environment configuration
* Production-ready folder structure
* Mongoose schemas created:

  * Cafe
  * User
  * Category
  * MenuItem
  * Table
  * Order
  * WaiterRequest
* Tenant-scoped indexing implemented
* Database validation completed

### Architecture Decisions

* Multi-tenant SaaS architecture
* Shared database with tenant isolation using `cafeId`
* MVC folder structure
* MongoDB + Mongoose stack

### Validation

* MongoDB connection successful
* All models loaded successfully
* Schema validation passed

### Challenges

* Designing scalable multi-tenant data model
* Planning tenant-safe indexing strategy

### Outcome

QRDine backend foundation established and ready for authentication layer.

---

## Sprint 2 – Authentication & Authorization

### Date

2026-06-07

### Goal

Implement secure authentication and authorization system.

### Completed

* Owner registration endpoint
* Cafe creation during registration
* Owner user creation linked to cafe
* JWT authentication
* Password hashing using bcryptjs
* Current user endpoint
* Authentication middleware
* Role-based authorization middleware
* Request validation middleware
* Centralized error handling
* Utility helpers

### Endpoints

* POST /api/auth/register-owner
* POST /api/auth/login
* GET /api/auth/me

### Architecture Decisions

* Registration creates Cafe + Owner in a single transaction
* JWT-based authentication
* Role system:

  * owner
  * manager
  * staff (reserved for future)

### Validation

* Registration tested successfully
* Login tested successfully
* Protected routes tested successfully
* Password hashing verified
* Duplicate registration prevention verified

### Outcome

QRDine now supports secure tenant onboarding and protected APIs.

---

## Sprint 3 – Categories & Menu Management

### Date

2026-06-07

### Goal

Allow cafes to manage categories and menu items securely.

### Completed

* Category CRUD
* Menu CRUD
* Tenant Middleware
* Owner and Manager Authorization
* Ownership Validation
* Availability Toggle Support
* Multi-Tenant Data Filtering

### Endpoints

Categories

* GET /api/categories
* POST /api/categories
* PUT /api/categories/:id
* DELETE /api/categories/:id

Menu

* GET /api/menu
* POST /api/menu
* PUT /api/menu/:id
* DELETE /api/menu/:id

### Architecture Decisions

* Tenant context injected through tenantMiddleware
* All data access scoped using cafeId
* Ownership checks required before update/delete

### Validation

* Protected routes working
* Tenant filtering verified
* CRUD operations verified

### Outcome

Cafe owners can now manage their complete menu catalog securely.
