Doctor Booking Backend
Node.js + Express + PostgreSQL backend for a doctor appointment booking system, inspired by platforms like RedBus/BookMyShow. It exposes REST APIs for admin and patient flows and handles concurrency to prevent overbooking.

Tech Stack
Node.js, Express

TypeScript

PostgreSQL (pg)

JWT for auth

Deployed on Render

Folder Structure (high level)
src/

index.ts – Express app bootstrap, routes, health checks

config/

db.ts – PostgreSQL Pool + SSL config for production

routes/

admin.ts – admin APIs (doctors, slots)

public.ts – public/patient APIs (doctors, slots, bookings, payments)

auth.ts – login and JWT

middleware/ (if any)

models/ or services/ (if you split logic)

dist/ – compiled JavaScript (after npm run build)

package.json

tsconfig.json

Installation (Local)
bash
git clone https://github.com/<your-username>/doctor-booking-backend.git
cd doctor-booking-backend
npm install
Environment Variables (Local)
Create a .env file:

text
PORT=4000
DATABASE_URL=postgres://postgres:<password>@localhost:5432/postgres
JWT_SECRET=dc4b8f6c77f421cddf305f7e85a36912b97b1f6772f7db92be498a0c6282717e
JWT_EXPIRES_IN=1d
Adjust DATABASE_URL to match your local Postgres.

Running Locally
bash
npm run build
npm run start
The server will start on http://localhost:4000 (unless PORT is set).

Health check:

GET /health → returns JSON with status and DB connectivity.

GET /debug/tables → lists DB tables (for debugging).

Environment Variables (Production)
On Render (or other host), configure:

DATABASE_URL – managed Postgres URL from hosting provider.

JWT_SECRET – same secret used in frontend for decoding tokens.

JWT_EXPIRES_IN – e.g., 1d.

NODE_ENV – production.

src/config/db.ts uses:

ts
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});
This enables SSL for Render’s Postgres.

Scripts
package.json:

"build": "tsc" – compile TypeScript to dist/.

"start": "node dist/index.js" – run compiled server.

On Render:

Build command: npm install && npm run build

Start command: npm run start

Core API Endpoints (Summary)
Auth
POST /api/auth/login

Request: { email, password }

Response: { token, user: { email, role } }

Used by frontend to get JWT for admin/patient.

Admin APIs
All require Authorization: Bearer <token> with admin role.

POST /api/admin/doctors

Create doctor: name, specialization, city, consultation_type, consultation_fee, rating.

GET /api/doctors

Public list of doctors (also used by admin).

POST /api/admin/doctors/:doctorId/slots

Create a slot with start_time, end_time.

DELETE /api/admin/doctors/:doctorId

Delete doctor (and related slots/bookings).

DELETE /api/admin/doctors/:doctorId/slots/:slotId

Delete a specific slot.

Public / Patient APIs
GET /api/doctors

List doctors.

GET /api/doctors/:doctorId/slots

List slots for doctor (with status).

POST /api/doctors/:doctorId/slots/:slotId/bookings

Create booking for a slot.

Body: patient_name, patient_email, reason.

Returns booking with status PENDING.

POST /api/payments/fake

Simulated payment.

Body: { booking_id, success: true/false }.

On success, sets booking status to CONFIRMED.

PATCH /api/bookings/:id/cancel

Cancel booking, update status.

PATCH /api/bookings/:id/reschedule

Body: { new_slot_id }

Moves booking to another available slot atomically.

GET /api/patients/bookings?email=...

Returns bookings for a given patient email with doctor and slot details.

Concurrency & Booking Expiry
Booking operations use DB transactions and constraints to avoid overbooking.

Only one active booking can be associated with a slot at a time.

PENDING bookings auto‑expire after 2 minutes:

Background logic/cron marks old PENDING bookings as FAILED.

This frees slots if not confirmed in time.

Deployment (Render) – Summary
Create Render PostgreSQL instance → copy DATABASE_URL.

Create Web Service from GitHub repo.

Set environment variables (DATABASE_URL, JWT_SECRET, etc.).

Use:

Build: npm install && npm run build

Start: npm run start

Verify:

GET https://<service>.onrender.com/health → status: "ok", db: "connected".

Testing
Use Postman or curl to test endpoints:

Health: GET /health

List doctors: GET /api/doctors

Auth: POST /api/auth/login

Booking: POST /api/doctors/:id/slots/:slotId/bookings

Frontend uses this backend via VITE_API_BASE_URL.