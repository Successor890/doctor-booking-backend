import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is NOT set");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
