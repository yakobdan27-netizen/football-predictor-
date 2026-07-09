import type { ClubIndex, ClubIndexEntry, ClubRecord } from "./club-record-types";

export function normalizeClubName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function slugifyClubName(name: string): string {
  const n = normalizeClubName(name);
  return n.slice(0, 24) || "club";
}

export function emptyClubIndex(): ClubIndex {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    clubs: [],
  };
}

export function findClubInIndex(
  index: ClubIndex,
  clubName: string,
  league: string
): ClubIndexEntry | undefined {
  const normalized = normalizeClubName(clubName);
  return index.clubs.find(
    (c) => c.normalizedName === normalized && c.league === league
  );
}

export function upsertClubIndexEntry(
  index: ClubIndex,
  entry: ClubIndexEntry
): ClubIndex {
  const others = index.clubs.filter((c) => c.clubId !== entry.clubId);
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    clubs: [...others, entry].sort((a, b) =>
      a.clubName.localeCompare(b.clubName)
    ),
  };
}

export function buildIndexEntry(record: ClubRecord): ClubIndexEntry {
  return {
    clubId: record.clubId,
    clubName: record.clubName,
    league: record.league,
    leagueId: record.leagueId,
    normalizedName: normalizeClubName(record.clubName),
  };
}

export function nextClubId(slug: string, counter: number): string {
  return `club_${slug}_${String(counter).padStart(3, "0")}`;
}
