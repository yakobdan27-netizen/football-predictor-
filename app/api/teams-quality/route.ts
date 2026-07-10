import { NextResponse } from "next/server";
import { findOrCreateClub } from "@/lib/prediction-log/club-store";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
import {
  loadTeamsQualityStore,
  saveTeamsQualityStore,
} from "@/lib/prediction-log/teams-quality-store";
import {
  mergeImportedTeams,
  normalizeLeagues,
  normalizeStore,
  normalizeTeamRecord,
  parseTeamsImport,
} from "@/lib/prediction-log/teams-quality";
import type { QualityTier } from "@/lib/prediction-log/teams-quality-types";

export async function GET() {
  try {
    const store = await loadTeamsQualityStore();
    return NextResponse.json({ store });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load teams quality";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { store?: unknown };
    if (!body.store) {
      return NextResponse.json({ error: "Missing store payload" }, { status: 400 });
    }
    const saved = await saveTeamsQualityStore(normalizeStore(body.store as never));
    return NextResponse.json({ store: saved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save teams quality";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "add" | "import";
      team_name?: string;
      tier?: QualityTier;
      league?: string;
      text?: string;
      mode?: "merge" | "replace";
    };

    const store = await loadTeamsQualityStore();

    if (body.action === "import") {
      const rows = parseTeamsImport(body.text ?? "");
      if (!rows.length) {
        return NextResponse.json({ error: "No valid teams found in import" }, { status: 400 });
      }
      const merged = mergeImportedTeams(store, rows, body.mode ?? "merge");
      const saved = await saveTeamsQualityStore(merged);
      return NextResponse.json({ store: saved, imported: rows.length });
    }

    if (!body.team_name?.trim() || !body.tier) {
      return NextResponse.json({ error: "team_name and tier are required" }, { status: 400 });
    }

    const teamName = body.team_name.trim();
    const league = body.league?.trim() ?? "";
    const isKnownLeague = (LEAGUE_OPTIONS as readonly string[]).includes(league);

    const existingIdx = store.teams.findIndex(
      (t) =>
        t.team_name.toLowerCase() === teamName.toLowerCase() ||
        t.team_id === teamName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    );
    const existing = existingIdx >= 0 ? store.teams[existingIdx] : null;

    // New custom teams (not already in store) require a league for roster membership.
    if (!existing && !isKnownLeague) {
      return NextResponse.json(
        { error: "league is required when adding a new team" },
        { status: 400 }
      );
    }

    let clubId = existing?.club_id;
    if (isKnownLeague) {
      const club = await findOrCreateClub(teamName, league);
      clubId = club.clubId;
    }

    const prevLeagues = normalizeLeagues(existing?.leagues);
    const nextLeagues = isKnownLeague
      ? normalizeLeagues([...prevLeagues, league])
      : prevLeagues;

    const record = normalizeTeamRecord(
      {
        team_name: teamName,
        tier: body.tier,
        leagues: nextLeagues,
        club_id: clubId ?? existing?.club_id,
        created_at: existing?.created_at,
        team_id: existing?.team_id,
      },
      store.tier_config
    );

    const teams = [...store.teams];
    if (existingIdx >= 0) {
      teams[existingIdx] = {
        ...teams[existingIdx]!,
        ...record,
        created_at: teams[existingIdx]!.created_at,
      };
    } else {
      teams.push(record);
    }
    teams.sort((a, b) => a.team_name.localeCompare(b.team_name));
    const saved = await saveTeamsQualityStore({ ...store, teams });
    return NextResponse.json({ store: saved, team: record });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Teams quality request failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
