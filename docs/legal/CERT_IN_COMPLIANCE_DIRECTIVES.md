# CERT-IN COMPLIANCE DIRECTIVES & AUDIT SPECIFICATION
**Statutory Authority:** Cyber Security Directions under Section 70B(6) of Information Technology Act, 2000  
**Directive Reference:** No. 20(3)/2022-CERT-In dated 28th April, 2022  
**Effective Scope:** QRDine Production Infrastructure, Multi-Tenant Cloud Services, and Associated Microservices

---

## 1. Statutory Mandate & Applicability

Under the CERT-In Directions issued on April 28, 2022, service providers, intermediaries, data centres, body corporate, and cloud service providers operating within India are required to strictly adhere to cybersecurity directives. As a multi-tenant B2B SaaS intermediary facilitating dining orders, digital payments, and patron data processing, QRDine implements these mandatory requirements across all clusters.

---

## 2. Requirement 1: Mandatory NTP Clock Synchronization

### 2.1 Authorized Indian NTP Reference Servers
Per Direction (i), all service providers and systems must connect to the Network Time Protocol (NTP) servers of the **National Physical Laboratory (NPL)** or the **National Informatics Centre (NIC)**, or servers traceable to these sources:

- **Primary Stratum-1 Source:** `time.nplindia.org` (CSIR - National Physical Laboratory, New Delhi)
- **Secondary Stratum-1 Source:** `time.nic.in` (National Informatics Centre, Government of India)
- **Tertiary Government Reference:** `samay1.nic.in` / `samay2.nic.in`

### 2.2 Synchronization Architecture
- **Production Host Configuration:** Chrony / systemd-timesyncd configuration on cloud host instances specifies NPL/NIC as authoritative time sources.
- **Application-Layer Validation (`certInService.js`):** The backend executes periodic UDP socket health checks on port 123 to verify server drift stays within the permissible threshold ($\pm 500\text{ ms}$).
- **Automated Verification Script:** System administrators and DevOps run `backend/scripts/certin-ntp-check.js` to assert live synchronization health before staging or production releases.

---

## 3. Requirement 2: 180-Day Log Retention Mandate

### 3.1 Statutory Retention Timeline
Per Direction (v), all service providers and cloud intermediaries must mandatorily enable logging of all communication systems and maintain logs securely for a rolling window of **180 consecutive calendar days**.

### 3.2 Scope of Maintained Logs
1. **User and Admin Access Logs:** All authentication attempts, privilege elevations, password resets, and session terminations.
2. **Database Query Audit Logs:** Creation, modification, or soft-deletion of dining sessions, orders, loyalty points, and merchant configuration.
3. **Application Security Logs:** Rate limit violations (HTTP 429), unauthorized access attempts (HTTP 401/403), CSRF rejections, and SQL/NoSQL injection tripwires.
4. **Network & Connection Logs:** Inbound request IP addresses, TLS handshake cipher suites, user agents, request latency, and HTTP response codes.

### 3.3 Data Residency & Tamper-Evident Storage
- **Geographic Residency:** All log repositories and cold storage buckets are strictly hosted in the Indian jurisdiction (AWS Mumbai `ap-south-1` / GCP Delhi `asia-south2`).
- **Immutability:** Log entries are ingested into append-only collections (`AuditLog` and `Incident`) with Write-Once-Read-Many (WORM) lifecycle policies.

---

## 4. Requirement 3: 6-Hour Cybersecurity Incident Reporting

### 4.1 Statutory Notification Window
Per Direction (ii), any cybersecurity incident falling under the specified 20 incident categories (including data breaches, unauthorized system access, ransomware attacks, identity theft, and denial of service) must be reported to CERT-In **within six (6) hours** of noticing or being brought to notice of the incident.

### 4.2 CERT-In Official Incident Response Contacts
- **Incident Reporting Email:** `incident@cert-in.org.in`
- **Toll-Free Emergency Hotline:** `1800-11-4949`
- **Secure Web Portal:** `https://www.cert-in.org.in`

### 4.3 Automated Annexure-I Dossier Generation
QRDine's incident management framework (`breachForensicService.js`) automatically exports the standardized **CERT-In Annexure-I Incident Reporting Format** containing:
- Precise incident detection timestamp (IST format).
- Affected system hostname, IP address, and geographic region.
- Attack vector / vulnerability exploited.
- Number of affected customer records and tenant entities.
- Immediate containment actions executed (e.g. token revocation, tenant isolation).

---

## 5. Verification Checklist for Operations

- [x] Host NTP configured with `time.nplindia.org` and `time.nic.in`.
- [x] CLI utility `node backend/scripts/certin-ntp-check.js` operational and passes drift check.
- [x] 180-day retention index verified on `AuditLog` collection.
- [x] Automated 6-hour CERT-In Annexure-I export route active at `/api/incidents/:id/certin-dossier`.
- [x] Indian sovereign cloud region locked to AWS Mumbai (`ap-south-1`).
