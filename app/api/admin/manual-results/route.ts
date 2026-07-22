import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin/auth";
import { NEXT_MATCHES_LEAGUES } from "@/lib/football-api/fetch-upcoming-league";
import { apiSeasonFromDate } from "@/lib/football-api/leagues";
import { resolveApiTeamId } from "@/lib/football-api/team-id-map";
import { todayIsoDate } from "@/lib/prediction-log/batch-date";
import { backfillBatchesFromManualResult } from "@/lib/prediction-log/manual-result-apply";
import {
  listManualResults,
  newManualResultId,
  saveManualResult,
} from "@/lib/prediction-log/manual-results-store";
import type { ManualResultRecord } from "@/lib/prediction-log/manual-results-types";
import { teamsForLeague } from "@/lib/prediction-log/teams";

function parseNonNegInt(v: unknown, label: string): number | NextResponse {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    return NextResponse.json(
      { error: `${label} must be an integer ≥ 0` },
      { status: 400 }
    );
  }
  return v;
}

function parseOptionalNonNegInt(
  v: unknown,
  label: string
): number | undefined | NextResponse {
  if (v == null || v === "") return undefined;
  return parseNonNegInt(v, label);
}

export async function GET(request: Request) {
  const denied = await requireAdminRequest(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize") ?? "20") || 20)
  );

  const all = await listManualResults();
  const total = all.length;
  const start = (page - 1) * pageSize;
  const records = all.slice(start, start + pageSize);

  return NextResponse.json({
    records,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

export async function POST(request: Request) {
  const denied = await requireAdminRequest(request);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const league = String(body.league ?? "").trim();
  if (!(NEXT_MATCHES_LEAGUES as readonly string[]).includes(league)) {
    return NextResponse.json(
      { error: "league must be one of the four supported leagues" },
      { status: 400 }
    );
  }

  const homeTeam = String(body.homeTeam ?? "").trim();
  const awayTeam = String(body.awayTeam ?? "").trim();
  if (!homeTeam || !awayTeam) {
    return NextResponse.json(
      { error: "homeTeam and awayTeam are required" },
      { status: 400 }
    );
  }
  if (homeTeam === awayTeam) {
    return NextResponse.json(
      { error: "homeTeam and awayTeam must differ" },
      { status: 400 }
    );
  }

  const roster = teamsForLeague(league);
  if (roster.length && (!roster.includes(homeTeam) || !roster.includes(awayTeam))) {
    return NextResponse.json(
      { error: "Teams must be from the selected league roster" },
      { status: 400 }
    );
  }

  const ftHome = parseNonNegInt(body.ftHome, "ftHome");
  if (ftHome instanceof NextResponse) return ftHome;
  const ftAway = parseNonNegInt(body.ftAway, "ftAway");
  if (ftAway instanceof NextResponse) return ftAway;

  const htHome = parseOptionalNonNegInt(body.htHome, "htHome");
  if (htHome instanceof NextResponse) return htHome;
  const htAway = parseOptionalNonNegInt(body.htAway, "htAway");
  if (htAway instanceof NextResponse) return htAway;
  if ((htHome == null) !== (htAway == null)) {
    return NextResponse.json(
      { error: "Provide both htHome and htAway, or neither" },
      { status: 400 }
    );
  }

  const matchDateRaw = body.matchDate != null ? String(body.matchDate).trim() : "";
  const matchDate =
    matchDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(matchDateRaw)
      ? matchDateRaw
      : undefined;
  if (matchDateRaw && !matchDate) {
    return NextResponse.json(
      { error: "matchDate must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const filledBy = String(body.filledBy ?? "").trim() || "admin";

  let homeApiTeamId =
    typeof body.homeApiTeamId === "number" && Number.isFinite(body.homeApiTeamId)
      ? body.homeApiTeamId
      : undefined;
  let awayApiTeamId =
    typeof body.awayApiTeamId === "number" && Number.isFinite(body.awayApiTeamId)
      ? body.awayApiTeamId
      : undefined;

  const season = apiSeasonFromDate(matchDate ?? todayIsoDate());
  if (homeApiTeamId == null || awayApiTeamId == null) {
    try {
      const [homeHit, awayHit] = await Promise.all([
        homeApiTeamId == null
          ? resolveApiTeamId({ teamName: homeTeam, league, season })
          : Promise.resolve(null),
        awayApiTeamId == null
          ? resolveApiTeamId({ teamName: awayTeam, league, season })
          : Promise.resolve(null),
      ]);
      if (homeHit?.teamId != null) homeApiTeamId = homeHit.teamId;
      if (awayHit?.teamId != null) awayApiTeamId = awayHit.teamId;
    } catch (e) {
      console.warn("manual-results team id resolve skipped", {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const filledAt = new Date().toISOString();
  let record: ManualResultRecord = {
    id: newManualResultId(),
    league,
    homeTeam,
    awayTeam,
    homeApiTeamId,
    awayApiTeamId,
    ftHome,
    ftAway,
    htHome,
    htAway,
    matchDate,
    filledBy,
    filledAt,
    batchesUpdatedCount: 0,
    matchLegsUpdatedCount: 0,
  };

  await saveManualResult(record);

  const { batchesUpdated, matchLegsUpdated } =
    await backfillBatchesFromManualResult(record, {
      includeNewerBatches: false,
    });

  record = {
    ...record,
    batchesUpdatedCount: batchesUpdated,
    matchLegsUpdatedCount: matchLegsUpdated,
  };
  await saveManualResult(record);

  return NextResponse.json({
    record,
    batchesUpdated,
    matchLegsUpdated,
  });
}
