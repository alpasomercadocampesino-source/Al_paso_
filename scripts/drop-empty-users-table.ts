import { Pool } from "pg";
import * as dotenv from "dotenv";
dotenv.config();

// La tabla "users" fue creada con columnas equivocadas (uid/email de Firebase Auth,
// que esta app no usa). Está vacía (0 filas) — se recrea con drizzle-kit push
// justo después con la estructura correcta (usuario/contrasena/rol).
async function main() {
  const pool = new Pool({
    host: process.env.SQL_HOST,
    user: process.env.SQL_ADMIN_USER,
    password: process.env.SQL_ADMIN_PASSWORD,
    database: process.env.SQL_DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  const countResult = await pool.query('SELECT COUNT(*) FROM "users";');
  const rowCount = parseInt(countResult.rows[0].count, 10);
  if (rowCount > 0) {
    console.error(`ABORTADO: la tabla users tiene ${rowCount} filas, no está vacía.`);
    await pool.end();
    process.exit(1);
  }

  await pool.query('DROP TABLE "users";');
  console.log("Tabla users (vacía) eliminada correctamente.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
