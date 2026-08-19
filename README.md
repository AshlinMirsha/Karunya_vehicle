# Karunya Bus Attendance Management System

A production-grade, secure, dynamic QR-code-based Bus Attendance Portal for **Karunya Institute of Technology and Sciences**, featuring domain-locked Supabase Auth, GPS coordinate tracking, strict server-side Supabase Edge Functions validation, and multi-role dashboards.

---

## 🌟 Key Features

- **Domain-Restricted Authentication**: Only users with official `@karunya.edu.in` Google accounts can authenticate via Supabase Auth.
- **Dynamic QR Code Sessions**: Dynamic tokens generated on-demand per bus session (Morning / Evening / Special) via the Coordinator dashboard.
- **Manual Faculty QR Generation**: QR codes are generated on-demand by bus coordinators directly on screen or sent via email when requested.
- **Server-Side Enforcement**: Zero client-side validation bypasses. Edge Functions enforce bus isolation, dynamic QR token cryptographic hashing, and duplicate prevention.
- **GPS Location Logging**: Captures and logs student GPS coordinates on attendance submission for live map visualization and auditability.
- **Glassmorphism UI**: Modern UI with full-screen video background, responsive elements, dark mode, toast notifications, and Leaflet/QRCode.js integrations.

---

## 🛠 Tech Stack

- **Frontend**: Hosted on Vercel (HTML/CSS/JS, Glassmorphism UI)
- **Backend**: Supabase (PostgreSQL Database)
- **Functions**: Supabase Edge Functions (Deno / TypeScript)
- **Email Service**: Raw SMTP via App Password (smtp.gmail.com)
- **Authentication**: Supabase Auth (Google Provider)

---

## 🚀 Deployment Guide

### 1. Prerequisites
Install Supabase CLI and Vercel CLI globally:
```bash
npm install -g supabase vercel
```

### 2. Configure Supabase Backend
Ensure your Supabase project has the necessary tables (`buses`, `profiles`, `attendance_sessions`, etc.). 

Set the environment variables (Secrets) for the Edge Functions in your Supabase Dashboard (or via CLI):
```bash
supabase secrets set EMAIL_ID="karunya.attendance@gmail.com"
supabase secrets set EMAIL_APP_PASSWORD="your_16_char_app_password"
```

### 3. Deploy Supabase Edge Functions
Deploy the `attendance-api` edge function to your linked Supabase project:
```bash
supabase functions deploy attendance-api
```

### 4. Deploy Frontend Application to Vercel
Log in to Vercel CLI:
```bash
vercel login
```

Deploy to production:
```bash
vercel --prod
```

Configure Environment Variables in Vercel Dashboard (for Supabase connection):
- `VITE_SUPABASE_URL` (or equivalent)
- `VITE_SUPABASE_ANON_KEY` (or equivalent)

---

## 🛡 Security Rules Summary

1. **Authentication**: All read/write requests require a valid JWT bearer token from Supabase Auth.
2. **Role-Based Access (RLS)**: Row Level Security policies ensure students can only mark their own attendance, and coordinators can only view their assigned buses.
3. **Edge Validation**: Attendance submission is processed securely, ensuring tokens are valid, unexpired, and location-verified correctly.
