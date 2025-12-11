import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./config/db";
import adminRouter from "./routes/admin";
import publicRouter from "./routes/public";
import authRouter from "./routes/auth";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT current_database(), current_schema()");
    res.json({ 
      status: "ok", 
      db: "connected",
      database_name: result.rows[0].current_database,
      schema: result.rows[0].current_schema
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", db: "not_connected" });
  }
});
app.get("/debug/tables", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "error listing tables" });
  }
});


// Use routers
app.use("/api/admin", adminRouter);
app.use("/api", publicRouter);
app.use("/api/auth", authRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
