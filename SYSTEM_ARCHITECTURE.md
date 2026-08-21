# Karunya Bus Attendance Management System — System Architecture

**Document Version**: 1.1.0  
**Target Audience**: Engineering Team, System Architects, Security Auditors  
**Classification**: Technical Architecture Specification  

---

## 1. Executive Summary

The **Karunya Bus Attendance Management System** is an enterprise-grade, secure, dynamic QR-code-based transit attendance verification platform designed for **Karunya Institute of Technology and Sciences**. Built on a **Zero-Trust Security Architecture**, it eliminates proxy attendance, location spoofing, and unauthorized check-ins across campus bus transit.

Key architectural pillars:
- **Domain-Locked Authentication**: Google OAuth 2.0 restricted strictly to `@karunya.edu.in` accounts and whitelisted `@karunya.edu` faculty emails.
- **Cryptographic Dynamic QR Sessions**: Ephemeral, 64-character random hex tokens salted with a server-side secret (`QR_SECRET`) and validated via SHA-256 digests.
- **Server-Side Zero-Trust Validation**: Zero client-side trust. All checks (token hashing, expiration, bus membership, GPS bounds, rate limits) run inside isolated Supabase Edge Functions (Deno Runtime).
- **Relational Data Integrity & RLS**: PostgreSQL database enforcing Row-Level Security (RLS) policies and database triggers for automated profile sync and audit logs.
- **Active Honeypot Incident Response**: Automated detection and alerting on unauthorized access attempts via `decoy-api` edge security handlers.

---

## 2. High-Level Architecture Diagram

```mermaid
graph TD
    subgraph Client Layer (Vercel Edge CDN Hosting)
        StudentApp["Student Mobile Web App<br/>(student.html, checkin.html)"]
        CoordApp["Coordinator Operations Dashboard<br/>(coordinator.html, operations-dashboard.js)"]
        AdminApp["Admin Central Console<br/>(admin.html, operations-dashboard.js)"]
        HoneypotApp["Honeypot Trap View<br/>(system-portal.html)"]
    end

    subgraph API & Gateway Layer (Supabase Edge Network)
        EdgeAPI["Supabase Edge Function: attendance-api<br/>(TypeScript / Deno Runtime)"]
        DecoyAPI["Supabase Edge Function: decoy-api<br/>(Incident Audit & Alert Handler)"]
        AuthGateway["Supabase Auth Gateway<br/>(Google OAuth 2.0 - Domain Enforced)"]
    end

    subgraph Persistence & Core Engine (Supabase Cloud PostgreSQL)
        DB[(PostgreSQL 15 Database)]
        RLSEngine["Row Level Security (RLS) Policies"]
        RPCEngine["PL/pgSQL Stored Procedures & Triggers"]
        AuditEngine["Security Audit Log & Rate Limiting Engine"]
    end

    StudentApp -->|OAuth 2.0 Auth| AuthGateway
    CoordApp -->|OAuth 2.0 Auth| AuthGateway
    AdminApp -->|OAuth 2.0 Auth| AuthGateway

    StudentApp -->|HTTPS REST / JWT| EdgeAPI
    CoordApp -->|HTTPS REST / JWT| EdgeAPI
    AdminApp -->|HTTPS REST / JWT| EdgeAPI

    HoneypotApp -->|Trap Alert Request| DecoyAPI

    EdgeAPI -->|Service Role DB Client| DB
    DecoyAPI -->|Log Audit Event| DB
    DB --- RLSEngine
    DB --- RPCEngine
    DB --- AuditEngine
```

---

## 3. Technology Stack & Layer Matrix

| Layer | Component | Technology / Library | Architectural Role |
| :--- | :--- | :--- | :--- |
| **Frontend UI** | Client Application | HTML5, Vanilla CSS3 (Glassmorphism), ES Modules | Lightweight, zero-framework overhead, responsive layout, dark theme |
| **QR Decoder** | Camera & Code Reader | Browser `BarcodeDetector` API + `jsQR` fallback | Hardware-accelerated native QR scanning with client-side fallback |
| **Export Engine** | Reports Engine | SheetJS (`xlsx.full.min.js`) | Dynamic client-side generation of structured Excel spreadsheets (.xlsx) |
| **API Gateway** | Primary Edge Function | Supabase Edge Functions (`attendance-api`) | Centralized API gateway enforcing rate limits, JWT auth & cryptographic checks |
| **Security Trap** | Honeypot Edge Function | Supabase Edge Functions (`decoy-api`) | Intercepts unauthorized probe paths (`/.env`, `/db_backup.sql`) and fires alerts |
| **Authentication** | Identity Provider | Supabase Auth (Google OAuth 2.0) | JWT bearer token verification and domain restriction enforcement |
| **Database** | Primary Storage | Supabase PostgreSQL 15 | Relational persistence, transactional consistency, PL/pgSQL triggers & RPCs |
| **Hosting** | Edge CDN | Vercel Global Edge Network | Sub-100ms global static asset delivery and SSL termination |

---

## 4. Database Schema & Entity-Relationship Diagram (ERD)

```mermaid
erdiagram
    AUTH_USERS ||--|| PROFILES : "1:1 trigger on signup"
    BUSES ||--o{ PROFILES : "assigned_to"
    BUSES ||--o{ ATTENDANCE_SESSIONS : "conducts"
    ATTENDANCE_SESSIONS ||--o{ ATTENDANCE : "records"
    PROFILES ||--o{ ATTENDANCE : "submits"
    PROFILES ||--o{ ATTENDANCE_SESSIONS : "initiates"
    BUSES ||--o{ BOARDING_POINTS : "has_stops"
    PROFILES ||--o| BOARDING_POINTS : "assigned_stop"

    PROFILES {
        uuid id PK
        string email UK
        string full_name
        enum role "student | coordinator | admin"
        string register_number UK
        uuid bus_id FK
        string status
        timestamp created_at
    }

    BUSES {
        uuid id PK
        integer bus_number UK
        string route
        double latitude
        double longitude
        integer capacity
        timestamp created_at
    }

    BOARDING_POINTS {
        uuid id PK
        uuid bus_id FK
        string point_name
        integer stop_number
        string pickup_time
    }

    ATTENDANCE_SESSIONS {
        uuid id PK
        uuid bus_id FK
        string session_type "Morning | Evening | Special"
        string token_hash UK
        timestamp expires_at
        uuid created_by FK
        timestamp created_at
    }

    ATTENDANCE {
        uuid id PK
        uuid session_id FK
        uuid student_id FK
        double latitude
        double longitude
        enum status "PRESENT"
        string submission "Self | Manual"
        string remark
        timestamp checked_in_at
    }
```

---

## 5. Security Model & Threat Mitigation

### 5.1 Zero-Trust Edge Validation
No client-side assertion of attendance is trusted. When a student submits a check-in request:
1. **JWT Verification**: Edge Function inspects `Authorization: Bearer <JWT>` header and retrieves the user identity via Supabase Auth API.
2. **Domain Sanity Check**: Ensures the caller's email ends with `@karunya.edu.in` or is a whitelisted faculty coordinator.
3. **Cryptographic Token Hash Match**:
   $$\text{token\_hash} = \text{SHA-256}(\text{QR\_SECRET} + \text{":"} + \text{token})$$
   Matches the digest against `attendance_sessions.token_hash`. Plaintext tokens are never stored in the database.
4. **Session Lifetime Check**: Verifies `expires_at > NOW()`.
5. **Bus Isolation Enforcement**: Verifies `session.bus_id === profile.bus_id`. A student assigned to Bus 1 scanning a QR code for Bus 2 will be rejected immediately (`HTTP 400: STUDENT BELONG TO THIS BUS INVALID SCAN YOUR BUS CODE`).
6. **Same-Day Duplicate Prevention**: Checks if attendance already exists for `(student_id, session_type)` in the current IST day (`+05:30`). Rejects duplicates with `HTTP 409: ALREADY MARKED PRESENT !!!`.

### 5.2 Rate Limiting & Abuse Controls
Rate limiting is enforced at the database level using an atomic PL/pgSQL function `consume_attendance_rate_limit`:
- Tracks actor request timestamps.
- Enforces sliding window request caps for `mark-attendance` and `create-session`.
- Rejects flood attempts with `HTTP 429 Too Many Requests` and logs security events in `security_audit_events`.

---

## 6. System Interface & API Gateway Specifications

All API operations route through the Deno Edge Function `attendance-api`:

- **Endpoint**: `POST /functions/v1/attendance-api`
- **Headers**:
  - `Authorization`: `Bearer <SUPABASE_USER_JWT>`
  - `Content-Type`: `application/json`

### Supported Actions Matrix

| Action | Required Role | Purpose |
| :--- | :--- | :--- |
| `create-session` | Coordinator | Generates dynamic 64-char QR token, stores SHA-256 hash with 5-hour TTL |
| `mark-attendance` | Student | Verifies QR token, checks bus assignment, verifies GPS coordinates, records check-in |
| `update-coordinator-location` | Coordinator | Updates live latitude/longitude for bus tracking |
| `manual-override-attendance` | Coordinator / Admin | Manually sets student status (`PRESENT`/`ABSENT`) with mandatory 3-250 char remark |
| `add-student` | Coordinator / Admin | Adds student email, reg number, and assigns to bus |
| `remove-student` | Coordinator / Admin | Unassigns student from bus |
| `move-student` | Admin | Reassigns student from one bus route to another |
| `add-coordinator` | Admin | Assigns coordinator role and bus ID to faculty email |
| `remove-coordinator` | Admin | Revokes coordinator role from faculty email |
| `add-bus` | Admin | Registers a new bus number, route description, and capacity |

---

## 7. Data Consistency & Timezone Engineering

### IST (+05:30) Timezone Handling
To avoid false duplicate rejections or date rolling errors across Midnight UTC (which occurs at 05:30 AM IST):
- All date boundaries for daily sessions are computed explicitly with IST offsets (`+05:30`).
- JavaScript local date parsing uses `(year, month - 1, day)` components rather than `toISOString().slice(0,10)`, avoiding UTC backward-shifts.
- Sunday exclusion logic (`cur.getDay() !== 0`) automatically filters non-operational weekend days from attendance matrix reports.
