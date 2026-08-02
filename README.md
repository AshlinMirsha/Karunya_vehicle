# Karunya Bus Attendance Management System

A production-grade, secure, dynamic QR-code-based Bus Attendance Portal for **Karunya Institute of Technology and Sciences**, featuring domain-locked Google OAuth (`@karunya.edu.in`), GPS Haversine Geofencing, strict server-side Cloud Functions validation, and multi-role Glassmorphism dashboards.

---

## 🌟 Key Features

- **Domain-Restricted Authentication**: Only users with official `@karunya.edu.in` Google accounts can authenticate via Firebase Google OAuth.
- **Dynamic QR Code Sessions**: Dynamic tokens created per bus session (Morning 5 AM / Evening 3 PM IST) via Cloud Scheduler & Coordinator dashboard.
- **Server-Side Enforcement**: Zero client-side validation bypasses. Cloud Functions enforce bus isolation, dynamic QR token cryptographic hashing, geofencing, and duplicate prevention.
- **GPS Geofencing**: Validates student coordinates using the Haversine formula against configured bus stop radii.
- **Glassmorphism UI**: Modern Bootstrap 5 UI with full-screen video background, responsive elements, dark mode, toast notifications, and Leaflet/QRCode.js integrations.

---

## 🛠 Project Structure

```
├── .env.example              # Environment Variable Template
├── firebase.json             # Firebase deployment configuration
├── firestore.rules           # Cloud Firestore Security Rules
├── package.json              # Main project dependencies and scripts
├── vercel.json               # Vercel deployment & routing config
├── assets/
│   ├── css/style.css        # Core glassmorphism design system
│   └── images/               # Media assets
├── components/
│   ├── navbar.js             # Reusable navigation bar component
│   └── toast.js              # Reusable toast notification component
├── firebase/
│   └── config.js             # Firebase SDK client initializer
├── functions/
│   ├── index.js              # Cloud Functions APIs (Auth, Attendance, Cron, Email)
│   └── package.json          # Node.js backend dependencies
├── js/
│   ├── auth.js               # Google Auth handler
│   ├── student.js            # Student dashboard logic
│   ├── coordinator.js        # Coordinator dynamic QR generator
│   ├── admin.js              # Admin fleet & student controls
│   └── qr-scanner.js         # Check-in verification logic
└── pages/
    ├── index.html            # Landing / Glassmorphism Login
    ├── student.html          # Student Dashboard
    ├── coordinator.html      # Coordinator Dashboard
    ├── admin.html            # Admin Dashboard
    └── checkin.html          # Attendance Check-in Portal
```

---

## 🚀 CLI Deployment Guide

### 1. Prerequisites
Install Firebase CLI and Vercel CLI globally:
```bash
npm install -g firebase-tools vercel
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your Firebase & Resend credentials:
```bash
cp .env.example .env
```

### 3. Deploy Backend APIs & Database to Firebase CLI
Log in to Firebase CLI:
```bash
firebase login
```

Initialize or select your Firebase project:
```bash
firebase use --add
```

Deploy Firestore Security Rules:
```bash
firebase deploy --only firestore:rules
```

Deploy Cloud Functions (Backend Logic & Automated Scheduled Cron):
```bash
firebase deploy --only functions
```

Set Environment Secrets on Firebase Cloud Functions:
```bash
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set QR_SECRET
```

### 4. Deploy Frontend Application to Vercel CLI
Log in to Vercel CLI:
```bash
vercel login
```

Deploy to production:
```bash
vercel --prod
```

Configure Environment Variables in Vercel Dashboard:
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `ALLOWED_EMAIL_DOMAIN` (`karunya.edu.in`)

---

## 🛡 Security Rules Summary

1. **Authentication**: All read/write requests require a valid JWT bearer token from Firebase Auth.
2. **Domain Lock**: Verified via `request.auth.token.email.endsWith('@karunya.edu.in')`.
3. **Write Isolation**: Direct writing to the `attendance` collection from client SDKs is blocked; writes are performed exclusively via Cloud Functions.
