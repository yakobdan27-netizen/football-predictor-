import { NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { parseCsv, rowToDbInsert } from "@/lib/csv";
import { cleanMatchRows } from "@/lib/data/clean-matches";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const textField = formData.get("text") as string | null;

    let csvText: string;
    if (file) {
      csvText = await file.text();
    } else if (textField) {
      csvText = textField;
    } else {
      return NextResponse.json(
        { error: "Provide a CSV file or text" },
        { status: 400 }
      );
    }

    const parsed = parseCsv(csvText);
    const { rows, report } = cleanMatchRows(parsed);
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "No valid rows after cleaning. Required: HomeTeam, AwayTeam, FTHG, FTAG",
          report,
        },
        { status: 400 }
      );
    }

    const db = await getDb();
    const inserts = rows.map(rowToDbInsert);
    await db.insert(schema.matches).values(inserts);

    return NextResponse.json({ imported: rows.length, report });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}