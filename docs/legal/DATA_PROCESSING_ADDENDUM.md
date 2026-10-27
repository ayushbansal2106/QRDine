# DATA PROCESSING ADDENDUM (DPA)
**Effective Date:** October 27, 2026  
**Version:** 2026.1  
**Statutory Framework:** Digital Personal Data Protection Act, 2023 (DPDP Act 2023) & Information Technology Act, 2000 (as amended)

This Data Processing Addendum ("**DPA**") supplements and forms an integral part of the **QRDine Master SaaS Agreement** entered into by and between **QRDine Platform** ("**Data Processor**") and the entity operating the food and beverage establishment registered on the platform ("**Data Fiduciary**" or "**Restaurant**").

---

## 1. Statutory Roles and Definitions

1.1 **Data Fiduciary:** Under Section 2(i) of the DPDP Act 2023, the Restaurant is the Data Fiduciary who determines the purpose and means of processing personal data collected from its dining customers, guests, and waitstaff.  
1.2 **Data Processor:** Under Section 2(k) of the DPDP Act 2023, QRDine is the Data Processor that processes personal data on behalf of the Data Fiduciary solely to provide the cloud dining and ordering SaaS services.  
1.3 **Data Principal:** Under Section 2(j) of the DPDP Act 2023, any natural person (dining customer, loyalty member, or staff member) whose personal data is processed.  
1.4 **Personal Data:** Any data about an individual who is identifiable by or in relation to such data, including customer phone numbers, names, ordering history, table dining sessions, and payment references.

---

## 2. Scope, Nature, and Purpose of Processing

| Parameter | Specification |
| :--- | :--- |
| **Categories of Data Principals** | Diners, restaurant patrons, registered staff, and cafe managers |
| **Categories of Personal Data** | Mobile phone numbers (masked/unmasked per role), customer names, table session identifiers, order items, timestamps, bill totals, and loyalty point ledgers |
| **Purpose of Processing** | QR-based contact-free ordering, kitchen ticket routing, automated dining bill generation, loyalty balance updates, and operational analytics |
| **Duration of Processing** | Term of the SaaS subscription plus statutory retention periods required by Indian law (e.g., 180 days CERT-In log retention mandate and 7 years for GST financial records) |

---

## 3. Obligations of the Data Processor (QRDine)

3.1 **Processing on Documented Instructions:** QRDine shall process personal data solely on documented instructions from the Data Fiduciary, including with respect to data transfers, and never for unauthorized profiling or third-party resale.  
3.2 **Confidentiality:** All personnel, contractors, and sub-processors authorized to access customer data are bound by strict statutory non-disclosure covenants.  
3.3 **Multi-Tenant Logical Isolation:** Tenant data is partitioned at every layer. Every database record contains an immutable `cafeId` filter index to strictly prevent cross-tenant data contamination or leakage.  
3.4 **Technical and Organizational Security Measures:**
- **Encryption in Transit:** Mandatory TLS 1.3 with HSTS enabled on all customer-facing and admin endpoints.
- **Encryption at Rest:** Sensitive tokens, credentials, and personal identifiers encrypted using AES-256.
- **Ephemeral Guest Sessions:** Unauthenticated guest ordering sessions rely on cryptographic guest tokens (`x-guest-token`) that expire post-dining checkout.
- **Log Sanitation:** Dynamic masking of customer phone numbers (`+91 98*** **321`) in application logs and public telemetry.

---

## 4. Sub-Processors

4.1 **Authorized Sub-Processors:** The Data Fiduciary hereby grants general authorization for QRDine to engage the following infrastructure providers:
- **Database & Hosting Infrastructure:** MongoDB Atlas (AWS Mumbai `ap-south-1` region) ensuring in-country Indian sovereign data residency.
- **Cloud Media Storage:** Cloudinary (encrypted media assets).
- **Communication Gateways:** Indian-registered transactional SMS & Email services for invoice and OTP delivery.
4.2 **Notification of Changes:** QRDine shall maintain an up-to-date registry of sub-processors and notify Data Fiduciaries at least 15 days prior to engaging any new sub-processor.

---

## 5. Data Principal Rights Assistance

5.1 **Right to Access & Correction (DPDP Act Sec 11 & 12):** QRDine provides self-service admin tools enabling the Data Fiduciary to export customer records or correct customer details upon formal request.  
5.2 **Right to Erasure / Right to be Forgotten (DPDP Act Sec 12(3)):** Upon receiving an erasure instruction from the Data Fiduciary, QRDine shall purge or irreversibly pseudonymize the specified customer's non-statutory records within 72 hours, preserving only records mandated by GST/tax statutes or CERT-In security retention rules.  
5.3 **Grievance Redressal:** QRDine provides a direct data protection contact point at `dpo@qrdine.in` for expedited resolution within statutory limits.

---

## 6. Personal Data Breach Management & CERT-In Emergency Protocol

6.1 **Breach Notification to Fiduciary:** In the event of a confirmed or suspected personal data breach affecting the Restaurant's data, QRDine shall notify the Data Fiduciary's registered primary contact without undue delay and **no later than four (4) hours** from detection.  
6.2 **Information to be Provided:**
- Nature and description of the security incident.
- Categories and approximate number of Data Principals and records affected.
- Identity and contact information of the Lead Incident Responder.
- Immediate containment actions executed (e.g., tenant quarantine, session invalidation).
- Recommendations to mitigate potential harm.  
6.3 **Support for Statutory Filings:** QRDine shall furnish the Data Fiduciary with a pre-compiled **CERT-In Annexure-I Dossier** to facilitate compliance with the mandatory **6-hour CERT-In incident reporting timeline** under Section 70B(6) of the Information Technology Act.

---

## 7. Data Return and Deletion upon Contract Termination

Upon termination of the SaaS agreement:
7.1 QRDine shall, at the choice of the Data Fiduciary, export all menu, order, and customer records in structured JSON/CSV format.  
7.2 Within thirty (30) days following termination, all tenant-specific live databases and transient caches shall be securely overwritten and deleted, except for immutable system audit logs retained strictly to satisfy the 180-day CERT-In retention requirement.

---

## 8. Governing Law and Jurisdiction

This DPA shall be governed by and construed in accordance with the laws of the Republic of India. The courts of **New Delhi, India** shall have exclusive jurisdiction over any disputes arising out of or in connection with this Addendum.
