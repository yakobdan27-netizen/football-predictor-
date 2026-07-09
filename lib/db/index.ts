import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { ensureSchema } from "./init";

export async function getDb() {
  const url =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  await ensureSchema();
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export { schema };
