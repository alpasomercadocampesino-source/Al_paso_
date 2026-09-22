import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import * as schema from "./schema.js";

// Se carga aquí (no solo en server.ts) porque este módulo puede importarse
// antes que cualquier otro punto de entrada llame a dotenv.config(), y
// necesita SQL_HOST/SQL_USER/etc. disponibles en el momento en que se crea el Pool.
dotenv.config();

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      ssl: { rejectUnauthorized: false },
      max: 10,
      connectionTimeoutMillis: 15000,
    });

    global._postgresPool.on("error", (err) => {
      console.error("Unexpected error on idle SQL pool client:", err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
