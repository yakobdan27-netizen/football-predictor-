import { sql } from "drizzle-orm";
import type { getDb } from "@/lib/db";

type Db = Awaited<ReturnType<typeof getDb>>;

/** Safe count(*) helper for neon-http execute results. */
export async function sqlCount(db: Db, query: string): Promise<number> {
  const r = await db.execute(sql.raw(query));
  const asArr = r as unknown as Array<{ c?: number }>;
  if (Array.isArray(asArr) && asArr[0] && typeof asArr[0].c === "number") {
    return asArr[0].c;
  }
  const rows = (r as unknown as { rows?: Array<{ c?: number }> }).rows;
  const c = rows?.[0]?.c;
  return typeof c === "number" ? c : 0;
}
