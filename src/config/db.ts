import { Pool } from "pg";

console.log("DATABASE_URL at runtime:", process.env.DATABASE_URL);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is NOT set");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
