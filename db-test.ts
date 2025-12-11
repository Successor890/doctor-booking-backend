import { Pool } from "pg";

async function main() {
  const pool = new Pool({
    user: "postgres",
    password: "Sanpost@2023",
    host: "localhost",
    port: 5432,
    database: "doctor_booking",
  });

  try {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
    );
    console.log("Tables seen from Node:", result.rows);
  } catch (err) {
    console.error("Error in db-test:", err);
  } finally {
    await pool.end();
  }
}

main();
