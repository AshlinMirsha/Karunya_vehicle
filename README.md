# Karunya Bus Attendance Management System

[![Build & Contracts Verification](https://img.shields.io/badge/Contracts-Passing-success?style=for-the-badge&logo=github)](https://github.com/)
[![Hosting](https://img.shields.io/badge/Hosting-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/)
[![Backend](https://img.shields.io/badge/Backend-Supabase_PostgreSQL-emerald?style=for-the-badge&logo=supabase)](https://supabase.com/)
[![Runtime](https://img.shields.io/badge/Runtime-Deno_TypeScript-blue?style=for-the-badge&logo=deno)](https://deno.land/)

A high-performance, enterprise-grade, dynamic QR-code-based Bus Attendance Portal for **Karunya Institute of Technology and Sciences**. Built on a **Zero-Trust Security Model**, it features domain-restricted Supabase OAuth 2.0 authentication, dynamic cryptographic QR code session generation, server-side GPS verification, row-level security (RLS), and multi-role dashboards for Students, Bus Coordinators, and System Administrators.

---

## 🌟 Key Features

- **Domain-Restricted Authentication**: Strictly locks platform sign-ins to official `@karunya.edu.in` accounts and pre-approved `@karunya.edu` faculty accounts via Supabase Google OAuth 2.0.
- **Dynamic Cryptographic QR Sessions**: On-demand session generation (*Morning*, *Evening*, *Special*) producing high-entropy 64-character random hex tokens hashed using `SHA-256(QR_SECRET + ":" + token)` with a 5-hour TTL.
- **Zero-Trust Edge Enforcement**: Zero client-side trust. All verification (JWT identity, token hash matching, bus route membership, same-day duplicate check) runs securely inside Deno Edge Functions.
- **Live Fleet Geolocation & Auditability**: Captures student GPS coordinates upon check-in and provides live bus location tracking for coordinators and administrators.
- **Multi-Role Operations Dashboards**:
  - **Student Portal**: Profile summary, assigned bus details, designated boarding point, scanner portal, and historical check-in audit log.
  - **Coordinator Console**: Dynamic QR generator, live passenger count, roster management, manual attendance overrides with mandatory remark logging, and automated Excel/Print matrix reports.
  - **Admin Control Center**: System-wide session stats, global bus route provisioning, student/coordinator reassignments, and security audit event monitoring.
- **Modern Glassmorphism UI**: Zero-framework, responsive HTML5/CSS3 client with dark-mode Glassmorphism aesthetics, toast notifications, native `BarcodeDetector` API QR scanner, and SheetJS Excel export engine.

---

## 🛠 Tech Stack

| Layer | Component | Technology |
| :--- | :--- | :--- |
| **Frontend** | Client Application | HTML5, Vanilla CSS3 (Glassmorphism), JavaScript ES Modules |
| **Hosting** | Edge CDN | Vercel Serverless Platform |
| **API Gateway** | Edge Functions | Supabase Edge Functions (Deno Runtime / TypeScript) |
| **Database** | Database Engine | Supabase PostgreSQL 15 (RLS, PL/pgSQL RPCs, Triggers) |
| **Authentication** | OAuth Provider | Supabase Auth (Google OAuth 2.0 Domain Locked) |
| **Testing** | Contract Tests | Node.js Native Test Runner (`node --test`) |

---

## 🏗 System Architecture

```mermaid
graph TD
    subgraph Client Layer (Vercel CDN)
        Student["Student Portal<br/>(/pages/student.html)"]
        Scanner["Check-in Scanner<br/>(/pages/checkin.html)"]
        Coord["Coordinator Dashboard<br/>(/pages/coordinator.html)"]
        Admin["Admin Console<br/>(/pages/admin.html)"]
    end

    subgraph API Gateway Layer (Supabase Edge Network)
        EdgeAPI["Edge Function: attendance-api<br/>(JWT, Crypto, Rate Limiter)"]
        Auth["Supabase Auth<br/>(Google OAuth 2.0)"]
    end

    subgraph Database Layer (Supabase Cloud PostgreSQL)
        DB[(PostgreSQL 15 Database)]
        RLS["Row Level Security Policies"]
        RPC["PL/pgSQL Resolvers & Triggers"]
    end

    Student --> Auth
    Scanner --> EdgeAPI
    Coord --> EdgeAPI
    Admin --> EdgeAPI

    EdgeAPI -->|Service Role Client| DB
    DB --- RLS
    DB --- RPC
```

---

## 🚀 Getting Started & Deployment Guide

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **Supabase CLI**: Installed globally (`npm install -g supabase`)
- **Vercel CLI**: Installed globally (`npm install -g vercel`)

### 2. Local Environment Setup
Clone the repository and inspect project structure:
```bash
git clone https://github.com/karunya/karunya-bus-attendance.git
cd karunya-bus-attendance
```

Create a `.env` file based on `.env.example`:
```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

### 3. Run Contract Tests
Validate all security contracts, JWT protections, scanner fallbacks, and database policies:
```bash
node --test tests/release-contracts.test.mjs
```

### 4. Deploy Supabase Backend
Link your Supabase project and set environment secrets:
```bash
supabase link --project-ref <your-project-ref>
supabase secrets set QR_SECRET="your_secure_random_qr_secret_key"
```

Deploy database migrations and Edge Functions:
```bash
supabase db push
supabase functions deploy attendance-api
```

### 5. Deploy Frontend to Vercel
Deploy to production via Vercel CLI:
```bash
vercel --prod
```

---

## 🛡 Security Specifications

1. **Authentication Lock**: All client calls require a valid JWT bearer token. Only `@karunya.edu.in` accounts pass database trigger registration.
2. **Cryptographic Protection**: QR tokens exist in plaintext only transiently in client memory during dynamic display. The backend stores exclusively salted `SHA-256` digests.
3. **Bus Route Isolation**: Students assigned to Bus $N$ scanning a QR code for Bus $M$ ($N \neq M$) are immediately rejected by the API (`HTTP 400`).
4. **Rate Limiting**: Sliding window rate limits managed via `consume_attendance_rate_limit` RPC block flood attempts (`HTTP 429`).
5. **Timezone Accuracy**: Strict IST (`+05:30`) date calculations prevent UTC midnight shift errors.

---

## 📁 Repository Structure

```
.
├── SYSTEM_ARCHITECTURE.md        # Technical System Architecture Specification
├── USER_USE_CASE_FLOW.md         # End-to-End Persona & Use Case Flow Document
├── README.md                     # Project Overview & Deployment Guide
├── DEPLOYMENT.md                 # Extended Operations Deployment Manual
├── vercel.json                   # Vercel CDN Routing, Headers, Honeypot Rewrites
├── components/                   # Shared UI Components (Navbar, Toast)
├── js/                           # Client JavaScript Modules
│   ├── admin.js                  # Admin Module Wrapper
│   ├── auth.js                   # Authentication & Session Redirect Utilities
│   ├── coordinator.js            # Coordinator Module Wrapper
│   ├── login-page.js             # OAuth Login Page Controller
│   ├── operations-dashboard.js   # Unified Operations Console (Admin/Coordinator)
│   ├── qr-scanner.js             # Camera QR Reader & Check-in Submission
│   ├── reports.js                # Attendance Matrix Reports & SheetJS Exporter
│   └── student.js                # Student Portal Controller
├── pages/                        # HTML Page Views
│   ├── admin.html                # Admin Central Console View
│   ├── checkin.html              # QR Scanner & Check-in View
│   ├── coordinator.html          # Coordinator Dashboard View
│   ├── index.html                # OAuth Login Landing Page
│   ├── student.html              # Student Dashboard View
│   └── system-portal.html        # Honeypot Security Audit View
├── supabase/                     # Supabase Backend Configuration
│   ├── client.js                 # Supabase JS SDK Client Instance
│   ├── config.toml               # Supabase CLI Project Configuration
│   ├── functions/
│   │   ├── attendance-api/       # Main Deno Edge Function (API Gateway)
│   │   └── decoy-api/            # Security Incident Honeypot Alert Function
│   └── migrations/               # PostgreSQL Database Migrations (70+ files)
└── tests/
    └── release-contracts.test.mjs # Release Contract Verification Suite
```

---

## 📄 License & Attribution

Designed and maintained for **Karunya Institute of Technology and Sciences**.  
Developed using standard web APIs, Supabase Cloud Infrastructure, and Vercel CDN Hosting.
