import { Router } from "express";
import { pool } from "../config/db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

// ---------- Helper: expire old pending bookings (2 minutes) ----------

async function expireOldPendingBookings() {
  // Mark old pending bookings as FAILED/FAILED
  await pool.query(
    `UPDATE bookings
     SET status = 'FAILED',
         payment_status = 'FAILED',
         updated_at = now()
     WHERE status = 'PENDING'
       AND payment_status = 'PENDING'
       AND now() - created_at > interval '2 minutes'`
  );

  // Free their slots
  await pool.query(
    `UPDATE slots
     SET status = 'AVAILABLE'
     WHERE id IN (
       SELECT slot_id
       FROM bookings
       WHERE status = 'FAILED'
         AND payment_status = 'FAILED'
         AND now() - created_at > interval '2 minutes'
     )`
  );
}

// ---------- Routes ----------

// Logged-in user info
router.get("/me", requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

// List all doctors
router.get("/doctors", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, specialization, city, consultation_type, consultation_fee, rating
       FROM doctors
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error listing doctors:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List AVAILABLE slots for a doctor
router.get("/doctors/:doctorId/slots", async (req, res) => {
  const doctorId = Number(req.params.doctorId);

  if (!doctorId) {
    return res.status(400).json({ error: "Valid doctorId is required" });
  }

  try {
    await expireOldPendingBookings();

    const result = await pool.query(
      `SELECT id, doctor_id, start_time, end_time, status
       FROM slots
       WHERE doctor_id = $1 AND status = 'AVAILABLE'
       ORDER BY start_time`,
      [doctorId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error listing slots:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATIENT (logged in): create booking for a slot
router.post(
  "/doctors/:doctorId/slots/:slotId/bookings",
  requireAuth,
  async (req: AuthRequest, res) => {
    const doctorId = Number(req.params.doctorId);
    const slotId = Number(req.params.slotId);
    const { patient_name, patient_email, reason } = req.body;
    const userId = req.user?.userId;

    if (!doctorId || !slotId || !patient_name || !patient_email) {
      return res.status(400).json({
        error: "doctorId, slotId, patient_name, patient_email are required",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const slotResult = await client.query(
        `SELECT id, doctor_id, start_time, status
         FROM slots
         WHERE id = $1
         FOR UPDATE`,
        [slotId]
      );

      const slot = slotResult.rows[0];

      if (!slot || slot.doctor_id !== doctorId) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Slot not found for this doctor" });
      }

      if (slot.status !== "AVAILABLE") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Slot is not available" });
      }

      const appointmentDateResult = await client.query(
        `SELECT $1::timestamp::date AS appointment_date`,
        [slot.start_time]
      );
      const appointment_date = appointmentDateResult.rows[0].appointment_date;

      const countResult = await client.query(
        `SELECT COUNT(*) AS count
         FROM bookings b
         JOIN slots s ON b.slot_id = s.id
         WHERE s.doctor_id = $1
           AND b.appointment_date = $2
           AND b.status <> 'CANCELLED'`,
        [doctorId, appointment_date]
      );

      const existingCount = Number(countResult.rows[0].count);
      const queue_number = existingCount + 1;

      const bookingResult = await client.query(
        `INSERT INTO bookings
           (slot_id,
            patient_id,
            patient_name,
            patient_email,
            reason,
            status,
            queue_number,
            appointment_date,
            token_amount,
            payment_status)
         VALUES
           ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8, 'PENDING')
         RETURNING *`,
        [
          slotId,
          userId,
          patient_name,
          patient_email,
          reason || null,
          queue_number,
          appointment_date,
          100.0,
        ]
      );

      await client.query(
        `UPDATE slots SET status = 'BOOKED' WHERE id = $1`,
        [slotId]
      );

      await client.query("COMMIT");
      return res.status(201).json(bookingResult.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error creating booking:", err);
      return res.status(500).json({ error: "Internal server error" });
    } finally {
      client.release();
    }
  }
);

// Admin view of bookings for a doctor
router.get("/admin/doctors/:doctorId/bookings", async (req, res) => {
  const doctorId = Number(req.params.doctorId);
  const { date } = req.query;

  if (!doctorId || !date) {
    return res
      .status(400)
      .json({ error: "doctorId and date (YYYY-MM-DD) are required" });
  }

  try {
    const result = await pool.query(
      `SELECT b.id,
              b.slot_id,
              b.patient_name,
              b.patient_email,
              b.reason,
              b.status,
              b.queue_number,
              b.appointment_date,
              s.start_time,
              s.end_time
       FROM bookings b
       JOIN slots s ON b.slot_id = s.id
       WHERE s.doctor_id = $1
         AND b.appointment_date = $2::date
       ORDER BY b.queue_number ASC`,
      [doctorId, date]
    );

    const avgConsultationMinutes = 10;

    const enriched = result.rows.map((row) => {
      const people_ahead = row.queue_number - 1;
      const estimated_wait_minutes = people_ahead * avgConsultationMinutes;
      return {
        ...row,
        people_ahead,
        estimated_wait_minutes,
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("Error listing bookings:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Queue preview for a doctor
router.get("/doctors/:doctorId/queue-preview", async (req, res) => {
  const doctorId = Number(req.params.doctorId);
  const { date } = req.query;

  if (!doctorId || !date) {
    return res
      .status(400)
      .json({ error: "doctorId and date (YYYY-MM-DD) are required" });
  }

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) AS count
       FROM bookings b
       JOIN slots s ON b.slot_id = s.id
       WHERE s.doctor_id = $1
         AND b.appointment_date = $2::date`,
      [doctorId, date]
    );

    const currentCount = Number(countResult.rows[0].count);
    const avgConsultationMinutes = 10;

    const people_ahead_now = currentCount;
    const estimated_wait_minutes_now = people_ahead_now * avgConsultationMinutes;

    return res.json({
      people_ahead_now,
      estimated_wait_minutes_now,
    });
  } catch (err) {
    console.error("Error getting queue preview:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Cancel booking
router.patch("/bookings/:bookingId/cancel", async (req, res) => {
  const bookingId = Number(req.params.bookingId);

  if (!bookingId) {
    return res.status(400).json({ error: "Valid bookingId is required" });
  }

  try {
    const bookingResult = await pool.query(
      `SELECT id, slot_id, status
       FROM bookings
       WHERE id = $1`,
      [bookingId]
    );

    const booking = bookingResult.rows[0];

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.status === "CANCELLED") {
      return res.status(400).json({ error: "Booking is already cancelled" });
    }

    const updatedBookingResult = await pool.query(
      `UPDATE bookings
       SET status = 'CANCELLED', updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [bookingId]
    );

    await pool.query(
      `UPDATE slots
       SET status = 'AVAILABLE'
       WHERE id = $1`,
      [booking.slot_id]
    );

    return res.json(updatedBookingResult.rows[0]);
  } catch (err) {
    console.error("Error cancelling booking:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Confirm booking (simulate payment success)
router.patch("/bookings/:bookingId/confirm", async (req, res) => {
  const bookingId = Number(req.params.bookingId);
  if (!bookingId) {
    return res.status(400).json({ error: "Valid bookingId is required" });
  }

  try {
    const result = await pool.query(
      `UPDATE bookings
       SET status = 'CONFIRMED',
           payment_status = 'SUCCESS',
           updated_at = now()
       WHERE id = $1
         AND status = 'PENDING'
         AND payment_status = 'PENDING'
       RETURNING *`,
      [bookingId]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({
        error: "Booking not found or not in PENDING/payment pending state",
      });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Error confirming booking:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Reschedule booking
router.patch("/bookings/:bookingId/reschedule", async (req, res) => {
  const bookingId = Number(req.params.bookingId);
  const { new_slot_id } = req.body;

  if (!bookingId || !new_slot_id) {
    return res
      .status(400)
      .json({ error: "bookingId and new_slot_id are required" });
  }

  try {
    const bookingResult = await pool.query(
      `SELECT b.id,
              b.status,
              b.slot_id,
              s.doctor_id AS old_doctor_id
       FROM bookings b
       JOIN slots s ON b.slot_id = s.id
       WHERE b.id = $1`,
      [bookingId]
    );

    const booking = bookingResult.rows[0];
    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }
    if (booking.status === "CANCELLED") {
      return res
        .status(400)
        .json({ error: "Cannot reschedule a cancelled booking" });
    }

    const oldSlotId = booking.slot_id;
    const oldDoctorId = booking.old_doctor_id;

    const newSlotResult = await pool.query(
      `SELECT id, doctor_id, start_time, status
       FROM slots
       WHERE id = $1`,
      [new_slot_id]
    );
    const newSlot = newSlotResult.rows[0];

    if (!newSlot) {
      return res.status(404).json({ error: "New slot not found" });
    }
    if (newSlot.status !== "AVAILABLE") {
      return res.status(400).json({ error: "New slot is not available" });
    }

    if (newSlot.doctor_id !== oldDoctorId) {
      return res
        .status(400)
        .json({ error: "Reschedule allowed only within the same doctor" });
    }

    const appointmentDateResult = await pool.query(
      `SELECT $1::timestamp::date AS appointment_date`,
      [newSlot.start_time]
    );
    const new_appointment_date = appointmentDateResult.rows[0].appointment_date;

    const countResult = await pool.query(
      `SELECT COUNT(*) AS count
       FROM bookings b
       JOIN slots s ON b.slot_id = s.id
       WHERE s.doctor_id = $1
         AND b.appointment_date = $2
         AND b.status <> 'CANCELLED'`,
      [newSlot.doctor_id, new_appointment_date]
    );

    const existingCount = Number(countResult.rows[0].count);
    const new_queue_number = existingCount + 1;

    const updatedBookingResult = await pool.query(
      `UPDATE bookings
       SET slot_id = $1,
           appointment_date = $2,
           queue_number = $3,
           updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [newSlot.id, new_appointment_date, new_queue_number, bookingId]
    );

    await pool.query(`UPDATE slots SET status = 'AVAILABLE' WHERE id = $1`, [
      oldSlotId,
    ]);
    await pool.query(`UPDATE slots SET status = 'BOOKED' WHERE id = $1`, [
      newSlot.id,
    ]);

    return res.json(updatedBookingResult.rows[0]);
  } catch (err) {
    console.error("Error rescheduling booking:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get full booking details
router.get("/bookings/:bookingId", async (req, res) => {
  const bookingId = Number(req.params.bookingId);
  if (!bookingId) {
    return res.status(400).json({ error: "Valid bookingId is required" });
  }

  try {
    const result = await pool.query(
      `SELECT
         b.id AS booking_id,
         b.status AS booking_status,
         b.queue_number,
         b.appointment_date,
         b.patient_name,
         b.patient_email,
         b.reason,
         s.id AS slot_id,
         s.start_time,
         s.end_time,
         s.status AS slot_status,
         d.id AS doctor_id,
         d.name AS doctor_name,
         d.specialization,
         d.city,
         d.consultation_type,
         d.consultation_fee,
         d.rating
       FROM bookings b
       JOIN slots s   ON b.slot_id = s.id
       JOIN doctors d ON s.doctor_id = d.id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const row = result.rows[0];

    const people_ahead = row.queue_number - 1;
    const estimated_wait_minutes = people_ahead * 10;

    const response = {
      booking: {
        id: row.booking_id,
        status: row.booking_status,
        queue_number: row.queue_number,
        appointment_date: row.appointment_date,
        patient_name: row.patient_name,
        patient_email: row.patient_email,
        reason: row.reason,
      },
      doctor: {
        id: row.doctor_id,
        name: row.doctor_name,
        specialization: row.specialization,
        city: row.city,
        consultation_type: row.consultation_type,
        consultation_fee: row.consultation_fee,
        rating: row.rating,
      },
      slot: {
        id: row.slot_id,
        start_time: row.start_time,
        end_time: row.end_time,
        status: row.slot_status,
      },
      people_ahead,
      estimated_wait_minutes,
    };

    return res.json(response);
  } catch (err) {
    console.error("Error getting booking:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// List bookings by patient email
router.get("/patients/bookings", async (req, res) => {
  const { email } = req.query;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    await expireOldPendingBookings();

    const result = await pool.query(
      `SELECT
         b.id AS booking_id,
         b.status AS booking_status,
         b.queue_number,
         b.appointment_date,
         b.reason,
         b.patient_email,
         b.payment_status,
         s.id AS slot_id,
         s.start_time,
         s.end_time,
         d.id AS doctor_id,
         d.name AS doctor_name,
         d.specialization,
         d.city
       FROM bookings b
       JOIN slots s   ON b.slot_id = s.id
       JOIN doctors d ON s.doctor_id = d.id
       WHERE b.patient_email = $1
         AND b.status <> 'CANCELLED'
       ORDER BY b.appointment_date, s.start_time`,
      [email]
    );

    const avgConsultationMinutes = 10;

    const response = result.rows.map((row) => {
      const people_ahead = row.queue_number - 1;
      const estimated_wait_minutes = people_ahead * avgConsultationMinutes;

      return {
        booking: {
          id: row.booking_id,
          status: row.booking_status,
          queue_number: row.queue_number,
          appointment_date: row.appointment_date,
          reason: row.reason,
          payment_status: row.payment_status,
        },
        doctor: {
          id: row.doctor_id,
          name: row.doctor_name,
          specialization: row.specialization,
          city: row.city,
        },
        slot: {
          id: row.slot_id,
          start_time: row.start_time,
          end_time: row.end_time,
        },
        people_ahead,
        estimated_wait_minutes,
      };
    });

    return res.json(response);
  } catch (err) {
    console.error("Error listing patient bookings:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Fake payment endpoint
router.post("/payments/fake", async (req, res) => {
  const { booking_id, success } = req.body;

  if (!booking_id || typeof success !== "boolean") {
    return res
      .status(400)
      .json({ error: "booking_id and success (boolean) are required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const bookingResult = await client.query(
      `SELECT id, slot_id, status, payment_status
       FROM bookings
       WHERE id = $1
       FOR UPDATE`,
      [booking_id]
    );

    const booking = bookingResult.rows[0];
    if (
      !booking ||
      booking.status !== "PENDING" ||
      booking.payment_status !== "PENDING"
    ) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Booking not found or not in PENDING/payment pending state",
      });
    }

    if (success) {
      const updated = await client.query(
        `UPDATE bookings
         SET status = 'CONFIRMED',
             payment_status = 'SUCCESS',
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [booking_id]
      );
      await client.query("COMMIT");
      return res.json(updated.rows[0]);
    } else {
      const updated = await client.query(
        `UPDATE bookings
         SET status = 'FAILED',
             payment_status = 'FAILED',
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [booking_id]
      );

      await client.query(
        `UPDATE slots
         SET status = 'AVAILABLE'
         WHERE id = $1`,
        [booking.slot_id]
      );

      await client.query("COMMIT");
      return res.json(updated.rows[0]);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error in fake payment:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;
