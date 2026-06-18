# Open Climb Aviation

A320 Pre-Type Rating Training Academy by Capt. Jay Kotecha.

## Stack

| Layer     | Tech                        |
|-----------|-----------------------------|
| Frontend  | HTML · CSS · Vanilla JS     |
| Backend   | Node.js · Express           |
| Database  | Supabase (PostgreSQL)       |
| Payments  | Razorpay                    |
| Email     | Nodemailer (Gmail SMTP)     |
| Deploy    | Vercel (FE) + Railway (BE)  |

## Quick Start

### 1. Database
Run `database/schema.sql` in your Supabase SQL Editor.

### 2. Backend
```bash
cd backend
cp .env.example .env
# fill in all values in .env
npm install
npm run dev
```

### 3. Frontend
Open `frontend/index.html` in a browser, or serve with any static server:
```bash
npx serve frontend
```

## Environment Variables
See `backend/.env.example` for all required variables.

## Project Structure
```
openclimb-aviation/
├── frontend/          # Static HTML pages
│   ├── index.html     # Landing + enquiry + auth
│   ├── dashboard.html # Student portal
│   └── admin.html     # Admin panel
├── backend/           # Express API
│   ├── server.js
│   └── routes/
│       ├── auth.js        # Register / Login / Me
│       ├── enrollment.js  # Courses / Enroll / Enquiry
│       ├── payment.js     # Razorpay order + verify
│       └── admin.js       # Admin CRUD + stats
└── database/
    └── schema.sql     # Supabase schema + seed data
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET  | /api/health | — | Health check |
| POST | /api/auth/register | — | Register student |
| POST | /api/auth/login | — | Login |
| GET  | /api/auth/me | JWT | Current user |
| GET  | /api/enrollment/courses | — | List active courses |
| POST | /api/enrollment/enquiry | — | Submit enquiry |
| POST | /api/enrollment/enroll | JWT | Enroll in course |
| GET  | /api/enrollment/my | JWT | My enrollments |
| POST | /api/payment/create-order | JWT | Create Razorpay order |
| POST | /api/payment/verify | JWT | Verify & confirm payment |
| GET  | /api/admin/stats | Admin JWT | Dashboard stats |
| GET  | /api/admin/users | Admin JWT | All users |
| GET  | /api/admin/enrollments | Admin JWT | All enrollments |
| PATCH| /api/admin/enrollments/:id | Admin JWT | Update enrollment status |
| GET  | /api/admin/payments | Admin JWT | All payments |
| GET  | /api/admin/enquiries | Admin JWT | All enquiries |
| PATCH| /api/admin/enquiries/:id | Admin JWT | Update enquiry status |
