import { Pool } from "pg";

export const pool = new Pool({
  user: "postgres",
  password: "Sanpost@2023",
  host: "localhost",
  port: 5432,
  database: "postgres", // NOT doctor_booking
});
