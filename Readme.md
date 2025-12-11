# Doctor Booking API

A RESTful backend for doctor appointment booking with **smart queue management**.

## Features
- Browse doctors by city/specialization
- View available time slots
- Book appointments with queue position
- **Smart queue insights**: `people_ahead` and `estimated_wait_minutes` computed from `queue_number`
- Cancel bookings
- Admin: manage doctor bookings by date
- Patient: list my bookings by email

## Key Endpoints

### Public Patient Flow
GET /api/doctors?city=Bangalore&specialization=Cardiologist
GET /api/doctors/:doctorId/slots?date=2025-12-10
POST /api/doctors/:doctorId/slots/:slotId/bookings
GET /api/bookings/:bookingId <- NEW: full booking + doctor + slot + queue info
GET /api/patients/bookings?email=... <- NEW: list all my bookings
PATCH /api/bookings/:bookingId/cancel
GET /api/doctors/:doctorId/queue-preview?date=...

text

### Sample Responses

**Single booking** (`GET /api/bookings/4`):
{
"booking": { "id": 4, "status": "PENDING", "queue_number": 2, "reason": "Checkup" },
"doctor": { "id": 1, "name": "Dr. Test", "specialization": "Cardiologist" },
"slot": { "id": 2, "start_time": "2025-12-10T10:00:00Z" },
"people_ahead": 1,
"estimated_wait_minutes": 10
}

text

**List bookings** (`GET /api/patients/bookings?email=neha@example.com`):
[ { "booking": {...}, "doctor": {...}, "slot": {...}, "people_ahead": 1, "estimated_wait_minutes": 10 } ]

text

## Smart Queue Logic
people_ahead = queue_number - 1
estimated_wait_minutes = people_ahead × 10 (avg consultation = 10 mins)

text

## Tech Stack
- Node.js + Express
- PostgreSQL (joins: bookings → slots → doctors)
- Postman collection included

## Quick Start
npm install
npm run dev

text

**Postman Collection**: `Doctor-Booking-API.postman_collection.json`