# Production Deployment Guide: Vercel CLI & Firebase CLI

This step-by-step guide explains how to deploy the **Karunya Bus Attendance System** to production using **Firebase CLI** (Backend, Cloud Functions, Firestore Security Rules) and **Vercel CLI** (Frontend UI).

---

## 1. Firebase CLI Setup & Deployment

### Step 1.1: Firebase Authentication & Domain Lock
1. Open the [Firebase Console](https://console.firebase.google.com/).
2. Navigate to **Authentication** -> **Sign-in method**.
3. Enable **Google** as a Sign-in Provider.
4. Under **Settings** -> **Authorized domains**, ensure `karunya.edu.in` and your Vercel deployment domain (e.g., `karunya-bus-attendance.vercel.app`) are added.

### Step 1.2: Deploy Firestore Security Rules
```bash
firebase deploy --only firestore:rules
```

### Step 1.3: Deploy Firebase Cloud Functions
Navigate to the root directory and deploy Cloud Functions:
```bash
firebase deploy --only functions
```

Set Cloud Function runtime variables. `QR_SECRET` is mandatory: generate a long random value and do not reuse a value from source control.
```bash
firebase functions:config:set \
  app.allowed_domain="karunya.edu.in" \
  app.qr_secret="YOUR_LONG_RANDOM_QR_SECRET" \
  app.resend_api_key="YOUR_RESEND_API_KEY" \
  app.app_url="https://YOUR-VERCEL-DOMAIN"
firebase deploy --only functions
```

---

## 2. Vercel CLI Setup & Deployment

### Step 2.1: Login to Vercel
```bash
vercel login
```

### Step 2.2: Preview Deployment
```bash
vercel
```

### Step 2.3: Production Deployment
```bash
vercel --prod
```

### Step 2.4: Set Vercel Environment Variables
Set the following environment variables in Vercel settings or via Vercel CLI:
```bash
vercel env add FIREBASE_API_KEY
vercel env add FIREBASE_AUTH_DOMAIN
vercel env add FIREBASE_PROJECT_ID
vercel env add ALLOWED_EMAIL_DOMAIN
```

---

## 3. Verification & Health Check

1. Access your deployed Vercel URL (e.g. `https://karunya-bus-attendance.vercel.app`).
2. Attempt login with a generic `@gmail.com` account — **Verification: System blocks access with domain restriction alert**.
3. Log in with an `@karunya.edu.in` account — **Verification: User is authenticated and routed to student portal**.
4. Generate a session QR in the Coordinator portal and complete check-in — **Verification: GPS geofence, bus isolation, and attendance log confirmed**.

## 4. Required Firestore Setup

Before inviting users, create the fleet and role documents in Firestore. Document IDs for `admins`, `coordinators`, and `students` must be the user's Firebase Authentication UID. A coordinator document must include `email` and `busId`; each bus document must include `busId`, `busNumber`, `latitude`, `longitude`, and `radiusMeters`.

New official-domain users are intentionally created as `pending_assignment`. An administrator must set their `busId`, `busNumber`, and `status: "active"` before they can mark attendance.
