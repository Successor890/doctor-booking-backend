import { Router } from "express";
import { pool } from "../config/db";
import { requireAuth, requireAdmin, AuthRequest } from "../middleware/auth";

const router = Router();

// ADMIN: create doctor
router.post(
  "/doctors",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    const {
      name,
      specialization,
      city,
      consultation_type,
      consultation_fee,
      rating,
    } = req.body;

    if (!name || !specialization || !city || !consultation_type || !consultation_fee) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const result = await pool.query(
        `INSERT INTO doctors
         (name, specialization, city, consultation_type, consultation_fee, rating)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, specialization, city, consultation_type, consultation_fee, rating`,
        [name, specialization, city, consultation_type, consultation_fee, rating || null]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Error creating doctor:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ADMIN: create slot for a doctor
router.post(
  "/doctors/:doctorId/slots",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res) => {
    const doctorId = Number(req.params.doctorId);
    const { start_time, end_time } = req.body;

    if (!doctorId || !start_time || !end_time) {
      return res
        .status(400)
        .json({ message: "doctorId, start_time, end_time required" });
    }

    try {
      const result = await pool.query(
        `INSERT INTO slots (doctor_id, start_time, end_time, status)
         VALUES ($1, $2, $3, 'AVAILABLE')
         RETURNING *`,
        [doctorId, start_time, end_time]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err: any) {
      console.error("Error creating slot:", err);
      if (err.code === "23505") {
        return res.status(409).json({
          message: "Slot at this time already exists for this doctor",
        });
      }
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

export default router;
