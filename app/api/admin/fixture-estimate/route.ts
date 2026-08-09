import { NextResponse } from "next/server";
import { readAdminSessionFromCookies } from "@/lib/admin/auth";
import { loadClubHalfAttackDefence, loadLeagueAfBaselines } from "@/lib/prediction-log/hsh-half-rates";
import { estimateTempoProfile } from "@/lib/prediction-log/half-tempo";
import { canonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import { fetchBatches } from "@/lib/prediction-log/storage";
import { matchLeague } from "@/lib/prediction-log/match-league";

export const runtime = "nodejs";

/** GET ?batchId=&matchId= — admin diagnostic for canonicalFixtureEstimate. */
export async function GET(request: Request) {
  const unlocked = await readAdminSessionFromCookies();
  if (!unlocked) {
    return NextResponse.json(
      { ok: false, error: "Admin unlock required" },
      { status: 401 }
    );
  }

  try {
    const url = new URL(request.url);
    const batchId = url.searchParams.get("batchId") ?? "";
    const matchId = url.searchParams.get("matchId") ?? "";
    if (!batchId || !matchId) {
      return NextResponse.json(
        { ok: false, error: "batchId and matchId required" },
        { status: 400 }
      );
    }

    const batches = await fetchBatches();
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) {
      return NextResponse.json({ ok: false, error: "Batch not found" }, { status: 404 });
    }
    const match = batch.matches.find((m) => m.id === matchId);
    if (!match) {
      return NextResponse.json({ ok: false, error: "Match not found" }, { status: 404 });
    }

    const league = matchLeague(match, batch.league);
    const homeRates = loadClubHalfAttackDefence(match.homeTeam, league, batches, {
      beforeDate: batch.date,
    });
    const awayRates = loadClubHalfAttackDefence(match.awayTeam, league, batches, {
      beforeDate: batch.date,
    });
    const { lgAf1, lgAf2 } = loadLeagueAfBaselines(league);
    const homeTempo = estimateTempoProfile(batches, match.homeTeam, {
      beforeDate: batch.date,
    });
    const awayTempo = estimateTempoProfile(batches, match.awayTeam, {
      beforeDate: batch.date,
    });

    const estimate = await canonicalFixtureEstimate({
      matchId: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      league,
      batches,
      beforeDate: batch.date,
      hshCtx: {
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league,
        homeRates,
        awayRates,
        lgAf1,
        lgAf2,
        homeTempo,
        awayTempo,
      },
    });

    return NextResponse.json({ ok: true, estimate });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
