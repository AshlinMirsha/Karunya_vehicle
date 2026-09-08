# Karunya Bus Attendance Management System

[![Build & Contracts Verification](https://img.shields.io/badge/Contracts-Passing-success?style=for-the-badge\&logo=github)](https://github.com/)
[![Hosting](https://img.shields.io/badge/Hosting-Vercel-black?style=for-the-badge\&logo=vercel)](https://vercel.com/)
[![Backend](https://img.shields.io/badge/Backend-Supabase_PostgreSQL-emerald?style=for-the-badge\&logo=supabase)](https://supabase.com/)
[![Runtime](https://img.shields.io/badge/Runtime-Deno_TypeScript-blue?style=for-the-badge\&logo=deno)](https://deno.land/)

**Ashlin Mirsha, Lohit, and Benesha** present the Karunya Bus Attendance Management System, a dynamic QR based attendance platform built for **Karunya Institute of Technology and Sciences**.

The system is designed to make bus attendance faster, easier to manage, and more secure. It uses Google OAuth authentication, dynamic QR sessions, server side location verification, PostgreSQL row level security, and role based dashboards for students, bus coordinators, and administrators.

Security is treated as a core part of the system rather than something added later. Attendance validation and authorization are handled on the server, while the database provides an additional layer of access control.

## Key Features

### Domain Restricted Authentication

Users sign in through Google OAuth using Supabase Auth.

Access is restricted to official `@karunya.edu.in` accounts and approved `@karunya.edu` faculty accounts. This prevents unauthorized accounts from registering with the system.

### Dynamic QR Attendance Sessions

Bus coordinators can create attendance sessions for different periods such as:

* Morning
* Evening
* Special

Each session generates a high entropy 64 character random token. The backend stores a SHA-256 hash derived from the QR secret and token instead of storing the token itself.

Sessions also have a limited lifetime of five hours.

### Server Side Attendance Validation

The client is not trusted to decide whether an attendance request is valid.

The Supabase Edge Function performs the important checks on the server, including:

* JWT authentication
* User identity verification
* QR token validation
* Bus assignment verification
* Same day duplicate attendance checks
* Rate limiting
* Request validation

This keeps important security decisions away from the browser.

### GPS Based Verification and Fleet Tracking

The system captures the student's GPS coordinates during check-in.

Coordinators and administrators can also view live bus location information, allowing the system to provide better visibility into bus operations.

### Student Dashboard

Students have access to a dedicated portal where they can view:

* Profile information
* Assigned bus
* Designated boarding point
* QR scanner
* Previous attendance records
* Check-in history

### Coordinator Dashboard

Bus coordinators can manage day to day attendance operations from a single dashboard.

Features include:

* Dynamic QR generation
* Live passenger count
* Bus passenger roster
* Manual attendance corrections
* Mandatory remarks for manual overrides
* Attendance reports
* Excel export
* Printable attendance matrices

### Administrator Dashboard

Administrators have access to system wide management features.

They can manage:

* Bus routes
* Student assignments
* Coordinator assignments
* Attendance sessions
* System statistics
* Security audit events

### Responsive Interface

The frontend is built using standard HTML, CSS, and JavaScript without a large frontend framework.

The interface uses a glassmorphism inspired design, responsive layouts, dark mode support, toast notifications, and the browser's native `BarcodeDetector` API where available.

SheetJS is used for generating Excel attendance reports.

## Tech Stack

| Layer          | Component          | Technology                                  |
| :------------- | :----------------- | :------------------------------------------ |
| Frontend       | Client Application | HTML5, Vanilla CSS3, JavaScript ES Modules  |
| Hosting        | Edge CDN           | Vercel                                      |
| API            | Edge Functions     | Supabase Edge Functions, Deno, TypeScript   |
| Database       | Database Engine    | Supabase PostgreSQL 15                      |
| Security       | Database Security  | Row Level Security, PL/pgSQL RPCs, Triggers |
| Authentication | OAuth Provider     | Supabase Auth, Google OAuth 2.0             |
| Testing        | Contract Tests     | Node.js Native Test Runner                  |

## System Architecture

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

## Getting Started

### Prerequisites

Make sure the following tools are installed:

* Node.js 18 or higher
* Supabase CLI
* Vercel CLI

Install the Supabase and Vercel CLIs if they are not already available:

```bash
npm install -g supabase
npm install -g vercel
```

### Clone the Repository

```bash
git clone https://github.com/karunya/karunya-bus-attendance.git
cd karunya-bus-attendance
```

### Configure the Environment

Create a `.env` file using `.env.example` as a reference:

```env
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

Use the appropriate Supabase project URL and anonymous key for your environment.

### Run the Contract Tests

The project includes a release contract test suite covering important application and security requirements.

Run the tests with:

```bash
node --test tests/release-contracts.test.mjs
```

### Configure Supabase

Link the local project to your Supabase project:

```bash
supabase link --project-ref <your-project-ref>
```

Set the QR secret used by the attendance API:

```bash
supabase secrets set QR_SECRET="your_secure_random_qr_secret_key"
```

### Deploy the Database and Edge Function

Apply the database migrations:

```bash
supabase db push
```

Deploy the attendance API:

```bash
supabase functions deploy attendance-api
```

### Deploy the Frontend

Deploy the frontend to Vercel:

```bash
vercel --prod
```

After deployment, configure the required environment variables in the Vercel project settings.

## Security

Security is built into the attendance flow at multiple levels.

### Authentication

Every protected API request requires a valid Supabase JWT.

Only authorized Karunya accounts can register and access the system.

### QR Token Protection

QR tokens are generated dynamically and are kept in plaintext only while they are being used by the client.

The backend stores a SHA-256 digest derived from the QR secret and token:

```text
SHA-256(QR_SECRET + ":" + token)
```

This means the original QR token does not need to be stored in the database.

### Bus Assignment Validation

Attendance is tied to a specific bus.

For example, if a student is assigned to Bus N and attempts to use a QR session belonging to Bus M, the server rejects the request.

The validation happens on the backend rather than relying on values supplied by the browser.

### Rate Limiting

Attendance requests are protected using a sliding window rate limiter.

The `consume_attendance_rate_limit` database function is used to prevent repeated or excessive check-in attempts.

Requests that exceed the configured limit receive an HTTP `429` response.

### Duplicate Attendance Protection

The backend checks whether the student has already recorded attendance for the relevant day and session.

This prevents repeated scans from creating multiple attendance records.

### Timezone Handling

Attendance dates are calculated using Indian Standard Time (`+05:30`).

This prevents issues where UTC date boundaries could cause an attendance record to be assigned to the wrong day.

### Database Security

Supabase PostgreSQL Row Level Security policies provide an additional authorization layer at the database level.

Database functions, triggers, and policies are used to enforce important system rules independently of the frontend.

## Repository Structure

```text
.
├── SYSTEM_ARCHITECTURE.md
├── USER_USE_CASE_FLOW.md
├── README.md
├── DEPLOYMENT.md
├── vercel.json
│
├── components/
│   ├── Navbar
│   └── Toast
│
├── js/
│   ├── admin.js
│   ├── auth.js
│   ├── coordinator.js
│   ├── login-page.js
│   ├── operations-dashboard.js
│   ├── qr-scanner.js
│   ├── reports.js
│   └── student.js
│
├── pages/
│   ├── admin.html
│   ├── checkin.html
│   ├── coordinator.html
│   ├── index.html
│   ├── student.html
│   └── system-portal.html
│
├── supabase/
│   ├── client.js
│   ├── config.toml
│   │
│   ├── functions/
│   │   ├── attendance-api/
│   │   └── decoy-api/
│   │
│   └── migrations/
│       └── 70+ migration files
│
└── tests/
    └── release-contracts.test.mjs
```

## Project Components

### Frontend

The frontend contains separate interfaces for each type of user.

The main pages are:

* `index.html` for authentication
* `student.html` for students
* `checkin.html` for QR based attendance
* `coordinator.html` for bus coordinators
* `admin.html` for administrators
* `system-portal.html` for the security honeypot interface

### Backend

The main backend logic is implemented through the `attendance-api` Supabase Edge Function.

It acts as the API gateway between the frontend and database and handles authentication, attendance validation, QR verification, rate limiting, and other security checks.

The `decoy-api` function supports the project's honeypot and security monitoring functionality.

### Database

The database is built on Supabase PostgreSQL and contains the application's core data and authorization logic.

More than 70 migration files are maintained in the repository to track database changes over time.

## Testing

Before deploying a release, run:

```bash
node --test tests/release-contracts.test.mjs
```

The contract tests verify important application requirements including:

* Authentication requirements
* JWT protection
* QR validation
* Scanner behavior
* Rate limiting
* Database security policies
* API contracts
* Security related application behavior

A deployment should only be considered ready after the contract suite passes successfully.

## Deployment

The application is split into two main deployment layers.

**Frontend**

The static frontend is deployed through Vercel and served through its edge network.

**Backend**

Authentication, database operations, and attendance validation are handled through Supabase.

The Edge Function runs on the Deno runtime and communicates with the PostgreSQL database.

This separation keeps the frontend lightweight while moving security sensitive operations to the backend.

## License and Attribution

Designed and maintained for **Karunya Institute of Technology and Sciences**.

Developed by **Ashlin Mirsha, Lohit, and Benesha** using standard web technologies, Supabase infrastructure, PostgreSQL, Deno, and Vercel.
