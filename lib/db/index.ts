import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { ensureSchema } from "./init";

type AppDb = NeonHttpDatabase<typeof schema>;

let cachedDb: AppDb | null = null;
let initPromise: Promise<AppDb> | null = null;

export async function getDb(): Promise<AppDb> {
  if (cachedDb) return cachedDb;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const url =
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      process.env.POSTGRES_PRISMA_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    await ensureSchema();
    const sql = neon(url);
    cachedDb = drizzle(sql, { schema });
    return cachedDb;
  })();

  try {
    return await initPromise;
  } catch (e) {
    initPromise = null;
    throw e;
  }
}

export { schema };
