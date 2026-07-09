import { NextResponse } from "next/server";
import { loadAllClubRecords, loadClubIndex } from "@/lib/prediction-log/club-store";

export async function GET() {
  try {
    const [index, clubs] = await Promise.all([
      loadClubIndex(),
      loadAllClubRecords(),
    ]);
    return NextResponse.json({
      exportedAt: new Date().toISOString(),
      index,
      clubs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Export failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
