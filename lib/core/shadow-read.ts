/**
 * Optional dual-read logging: hist fixture vs analytics_v_fixture_compat.
 * Never returns core data to pages — legacy remains authoritative.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { isCoreShadowFixtureReadEnabled } from "@/lib/core/feature-flags";

export type ShadowFixtureDiff = {
  providerFixtureId: number;
  diffs: string[];
};

/**
 * When CORE_SHADOW_FIXTURE_READ=1, compare one AF fixture id and console.warn diffs.
 * Always returns null for page use (callers must keep returning hist/legacy).
 */
export async function shadowCompareFixtureByProviderId(
  providerFixtureId: number
): Promise<ShadowFixtureDiff | null> {
  if (!isCoreShadowFixtureReadEnabled()) return null;

  try {
    const db = await getDb();
    const query = `
      SELECT
        h.fixture_id,
        h.home_team,
        h.away_team,
        h.ft_home,
        h.ft_away,
        h.ht_home,
        h.ht_away,
        v.home_team_name AS v_home,
        v.away_team_name AS v_away,
        v.ft_home AS v_ft_home,
        v.ft_away AS v_ft_away,
        v.ht_home AS v_ht_home,
        v.ht_away AS v_ht_away
      FROM hist_fixtures h
      INNER JOIN core_legacy_record_map m
        ON m.legacy_source_table = 'hist_fixtures'
       AND m.legacy_pk = h.fixture_id::text
       AND m.verified = 1
      INNER JOIN analytics_v_fixture_compat v
        ON v.core_fixture_id = m.canonical_entity_id
      WHERE h.fixture_id = ${providerFixtureId}
      LIMIT 1
    `;
    const r = await db.execute(sql.raw(query));
    const rows = (
      Array.isArray(r) ? r : (r as { rows?: Array<Record<string, unknown>> }).rows ?? []
    ) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;

    const diffs: string[] = [];
    const pairs: Array<[string, unknown, unknown]> = [
      ["home", row.home_team, row.v_home],
      ["away", row.away_team, row.v_away],
      ["ft_home", row.ft_home, row.v_ft_home],
      ["ft_away", row.ft_away, row.v_ft_away],
      ["ht_home", row.ht_home, row.v_ht_home],
      ["ht_away", row.ht_away, row.v_ht_away],
    ];
    for (const [k, a, b] of pairs) {
      if (a !== b) diffs.push(`${k}: legacy=${String(a)} core=${String(b)}`);
    }
    if (diffs.length) {
      console.warn(
        `[core-shadow] fixture ${providerFixtureId} diffs: ${diffs.join("; ")}`
      );
    }
    return { providerFixtureId, diffs };
  } catch (e) {
    console.warn(
      `[core-shadow] compare failed for ${providerFixtureId}:`,
      e instanceof Error ? e.message : e
    );
    return null;
  }
}
