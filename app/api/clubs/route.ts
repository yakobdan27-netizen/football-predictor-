import { NextResponse } from "next/server";
import { loadClubIndex } from "@/lib/prediction-log/club-store";

export async function GET() {
  try {
    const index = await loadClubIndex();
    return NextResponse.json({ index });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load club index";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
