import { NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/telegram/internal-auth";
import { listLeagues, listTeams, resolveTeamInput } from "@/lib/telegram/team-resolve";

export async function GET(request: Request) {
  const denied = requireInternalApiKey(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const league = url.searchParams.get("league")?.trim();
  const q = url.searchParams.get("q")?.trim();

  if (!league) {
    return NextResponse.json({ ok: true, leagues: listLeagues() });
  }

  if (q) {
    const resolved = resolveTeamInput(league, q);
    return NextResponse.json({ ok: true, league, ...resolved, teams: listTeams(league) });
  }

  return NextResponse.json({ ok: true, league, teams: listTeams(league) });
}
