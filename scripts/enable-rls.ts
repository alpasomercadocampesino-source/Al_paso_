import { Pool } from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const TABLES = [
  "users", "products", "providers", "orders", "closures", "wallet_transactions",
  "shrinkages", "packaging_movements", "employee_schedules", "employee_loans",
  "employee_rates", "payroll_records", "price_histories", "nequi_expenses",
  "sync_logs", "branch_configs",
];

async function main() {
  const pool = new Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_ADMIN_USER,
    password: process.env.SQL_ADMIN_PASSWORD,
    database: process.env.SQL_DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  for (const table of TABLES) {
    await pool.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
    console.log(`RLS enabled on ${table}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
