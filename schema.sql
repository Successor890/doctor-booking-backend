-- Clean up (dev only)
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS slots;
DROP TABLE IF EXISTS doctors;
DROP TABLE IF EXISTS users;

-- Users: patients and admins
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('PATIENT', 'ADMIN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Doctors: core for recommendation
CREATE TABLE doctors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  specialization VARCHAR(100) NOT NULL,   -- e.g. "Cardiologist"
  city VARCHAR(100) NOT NULL,
  consultation_type VARCHAR(20) NOT NULL DEFAULT 'OFFLINE', -- OFFLINE | ONLINE | BOTH
  consultation_fee INTEGER NOT NULL DEFAULT 500,
  rating NUMERIC(2,1) DEFAULT 4.5,        -- 0.0 - 5.0
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Slots: individual appointment times for each doctor
CREATE TABLE slots (
  id SERIAL PRIMARY KEY,
  doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE | BOOKED | BLOCKED
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doctor_id, start_time)  -- prevent duplicate slot times per doctor
);

-- Bookings: actual patient appointments
CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  slot_id INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  patient_id INTEGER REFERENCES users(id),   -- link to users table
  patient_name VARCHAR(100) NOT NULL,
  patient_email VARCHAR(200) NOT NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING | CONFIRMED | FAILED | NO_SHOW | CANCELLED
  queue_number INTEGER,                         -- for real-time queue tracking
  appointment_date DATE NOT NULL,               -- extracted from slot start_time
  token_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful indexes
CREATE INDEX idx_bookings_slot_id ON bookings(slot_id);
CREATE INDEX idx_slots_doctor_start ON slots(doctor_id, start_time);
CREATE INDEX idx_bookings_appointment_date ON bookings(appointment_date);
