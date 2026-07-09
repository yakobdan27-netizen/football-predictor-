import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { makeDemoData } from "@/lib/predictor";
import { rowToDbInsert } from "@/lib/csv";

export async function POST() {
  try {
    const db = await getDb();
    const [{ value: existing }] = await db
      .select({ value: count() })
      .from(schema.matches);

    if (existing > 0) {
      return NextResponse.json({
        ok: true,
        message: "Database already has data",
        count: existing,
      });
    }

    const demo = makeDemoData();
    const inserts = demo.map(rowToDbInsert);
    const chunkSize = 500;
    for (let i = 0; i < inserts.length; i += chunkSize) {
      await db.insert(schema.matches).values(inserts.slice(i, i + chunkSize));
    }

    return NextResponse.json({ ok: true, seeded: demo.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Seed failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = await getDb();
    const [{ value }] = await db
      .select({ value: count() })
      .from(schema.matches);
    return NextResponse.json({ matches: value });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Stats failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
