/**
 * Phase 1: emit docs/database_dependency_inventory.md from schema + codebase refs.
 * Run: npx tsx scripts/db-dependency-inventory.ts
 *
 * Read-only — never mutates DB or KV.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const SCHEMA_PATH = join(ROOT, "lib", "db", "schema.ts");
const OUT_PATH = join(ROOT, "docs", "database_dependency_inventory.md");

/** Hard-fail review list — must not be altered by additive core work. */
const PROTECTED_PG = [
  "hist_*",
  "team_half_stats",
  "hist_league_half_params",
  "live_*",
  "match_stats",
  "bet_*",
  "ext_*",
  "slip_*",
  "matches",
] as const;

const PROTECTED_KV = [
  "batch:*",
  "batchIndex",
  "club:*",
  "manual-results",
  "learner/priors keys",
] as const;

const PROTECTED_CODE = [
  "Analysis apps",
  "Decision Maker",
  "Prediction Log",
  "result sync/trace",
  "bets settle",
] as const;

const TABLE_HINTS: Record<
  string,
  { reads: string; writes: string; pages: string; risk: string; protected: boolean }
> = {
  matches: {
    reads: "CSV import / legacy match lists",
    writes: "seed/upload routes",
    pages: "legacy match tools",
    risk: "medium",
    protected: true,
  },
  live_leagues: {
    reads: "live fixtures feed",
    writes: "lib/live sync",
    pages: "Match Centre live",
    risk: "high",
    protected: true,
  },
  live_fixtures: {
    reads: "live + settle + DM open-in",
    writes: "lib/live only",
    pages: "Match Centre, bets settle",
    risk: "critical",
    protected: true,
  },
  live_events: {
    reads: "live detail",
    writes: "lib/live",
    pages: "live fixture detail",
    risk: "high",
    protected: true,
  },
  live_sync_meta: {
    reads: "system-info / sync status",
    writes: "live sync jobs",
    pages: "ops panels",
    risk: "medium",
    protected: true,
  },
  match_stats: {
    reads: "stats backfill consumers",
    writes: "stats API backfill",
    pages: "corners / stats tools",
    risk: "high",
    protected: true,
  },
  stats_backfill_meta: {
    reads: "backfill status",
    writes: "stats cron",
    pages: "ops",
    risk: "low",
    protected: false,
  },
  team_season_stats: {
    reads: "team quality / ratings helpers",
    writes: "stats aggregate jobs",
    pages: "Teams & Leagues",
    risk: "medium",
    protected: false,
  },
  bet_events: {
    reads: "bets feed",
    writes: "bets load",
    pages: "Bet Tracker",
    risk: "critical",
    protected: true,
  },
  bet_markets: {
    reads: "bets",
    writes: "bets load",
    pages: "Bet Tracker",
    risk: "critical",
    protected: true,
  },
  bet_slips: {
    reads: "bets slips",
    writes: "bets slips/settle",
    pages: "Bet Tracker",
    risk: "critical",
    protected: true,
  },
  bet_selections: {
    reads: "bets settle",
    writes: "bets slips/settle",
    pages: "Bet Tracker",
    risk: "critical",
    protected: true,
  },
  ext_users: {
    reads: "external coupons",
    writes: "ext coupon APIs",
    pages: "external bet UI",
    risk: "high",
    protected: true,
  },
  ext_slips: {
    reads: "external coupons",
    writes: "ext coupon APIs",
    pages: "external bet UI",
    risk: "high",
    protected: true,
  },
  ext_selections: {
    reads: "external coupons",
    writes: "ext coupon APIs",
    pages: "external bet UI",
    risk: "high",
    protected: true,
  },
  hist_fixtures: {
    reads: "analysis, DIEH, half goals, coverage",
    writes: "lib/hist only",
    pages: "Goals & Survival, Research, Decision Maker inputs",
    risk: "critical",
    protected: true,
  },
  hist_goals: {
    reads: "half/goal timing models",
    writes: "lib/hist",
    pages: "analysis apps",
    risk: "critical",
    protected: true,
  },
  hist_stats: {
    reads: "corners / shots models",
    writes: "lib/hist",
    pages: "analysis apps",
    risk: "critical",
    protected: true,
  },
  hist_lineups: {
    reads: "optional hist completeness",
    writes: "lib/hist",
    pages: "coverage audit",
    risk: "medium",
    protected: true,
  },
  hist_teams: {
    reads: "hist team directory",
    writes: "lib/hist",
    pages: "Teams & Leagues",
    risk: "high",
    protected: true,
  },
  hist_jobs: {
    reads: "hist backfill status",
    writes: "hist cron/drain",
    pages: "system-info",
    risk: "medium",
    protected: true,
  },
  hist_meta: {
    reads: "model params / betas / priors",
    writes: "lib/hist recompute",
    pages: "analysis apps",
    risk: "critical",
    protected: true,
  },
  team_half_stats: {
    reads: "2H-heavy / half intensity",
    writes: "lib/hist",
    pages: "analysis + DM",
    risk: "critical",
    protected: true,
  },
  hist_league_half_params: {
    reads: "DIEH / half share",
    writes: "lib/hist fit-half-params",
    pages: "DIEH, Goals & Survival",
    risk: "critical",
    protected: true,
  },
  team_ratings: {
    reads: "prediction engines",
    writes: "hist recompute",
    pages: "analysis apps",
    risk: "high",
    protected: false,
  },
  slip_batches: {
    reads: "slip builder history",
    writes: "slip builder commit",
    pages: "Combo Centre / Slip Builder",
    risk: "high",
    protected: true,
  },
  slip_batch_legs: {
    reads: "slip builder history",
    writes: "slip builder commit",
    pages: "Combo Centre / Slip Builder",
    risk: "high",
    protected: true,
  },
};

function listPgTablesFromSchema(): string[] {
  const src = readFileSync(SCHEMA_PATH, "utf8");
  const names = new Set<string>();
  const re = /pgTable\(\s*["']([a-z0-9_]+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) names.add(m[1]!);
  return [...names].sort();
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir)) {
    if (
      ent === "node_modules" ||
      ent === ".git" ||
      ent === ".next" ||
      ent === "dist"
    ) {
      continue;
    }
    const full = join(dir, ent);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else if (/\.(ts|tsx|js|jsx|md)$/.test(ent)) out.push(full);
  }
  return out;
}

function countRefs(table: string, files: string[]): { count: number; samples: string[] } {
  const needle = table;
  const samples: string[] = [];
  let count = 0;
  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    if (rel === "docs/database_dependency_inventory.md") continue;
    if (rel.startsWith("scripts/db-dependency-inventory")) continue;
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (!text.includes(needle)) continue;
    count++;
    if (samples.length < 6) samples.push(rel);
  }
  return { count, samples };
}

function isProtectedTable(name: string): boolean {
  if (TABLE_HINTS[name]?.protected) return true;
  if (name.startsWith("hist_")) return true;
  if (name.startsWith("live_")) return true;
  if (name.startsWith("bet_")) return true;
  if (name.startsWith("ext_")) return true;
  if (name.startsWith("slip_")) return true;
  if (name === "matches" || name === "match_stats" || name === "team_half_stats") {
    return true;
  }
  return false;
}

function main() {
  const tables = listPgTablesFromSchema();
  const files = walkFiles(ROOT);
  const generatedAt = new Date().toISOString();

  const lines: string[] = [];
  lines.push("# Database dependency inventory");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push(
    "Additive `core_*` / `analytics_*` / `audit_*` work must not alter protected objects below. Existing stores remain authoritative until dual-read comparison passes."
  );
  lines.push("");
  lines.push("## Protected objects (hard fail in review if altered)");
  lines.push("");
  lines.push("| Store | Objects |");
  lines.push("|---|---|");
  lines.push(`| PG | ${PROTECTED_PG.join(", ")} |`);
  lines.push(`| KV | ${PROTECTED_KV.join(", ")} |`);
  lines.push(`| Code | ${PROTECTED_CODE.join(", ")} |`);
  lines.push("");
  lines.push("## Postgres tables (`lib/db/schema.ts`)");
  lines.push("");
  lines.push(
    "| Object | Protected | Risk | Read paths | Write paths | Dependent pages | Code refs (files) | Sample paths |"
  );
  lines.push("|---|---|---|---|---|---|---|---|");

  for (const t of tables) {
    const hint = TABLE_HINTS[t] ?? {
      reads: "see code refs",
      writes: "see code refs",
      pages: "see code refs",
      risk: "unknown",
      protected: isProtectedTable(t),
    };
    const protectedFlag = isProtectedTable(t) || hint.protected;
    const refs = countRefs(t, files);
    lines.push(
      `| \`${t}\` | ${protectedFlag ? "YES" : "no"} | ${hint.risk} | ${hint.reads} | ${hint.writes} | ${hint.pages} | ${refs.count} | ${refs.samples.join(", ") || "—"} |`
    );
  }

  lines.push("");
  lines.push("## KV stores (Prediction Log / clubs)");
  lines.push("");
  lines.push("| Object | Protected | Risk | Read paths | Write paths | Dependent pages |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(
    "| `batch:*` / `batchIndex` | YES | critical | `lib/prediction-log/club-store.ts` | batch APIs, sync-results, telegram | Prediction Log, Decision Maker batch pickers |"
  );
  lines.push(
    "| `club:*` | YES | high | club-store / club histories | club history writer | Clubs pages |"
  );
  lines.push(
    "| manual-results / learner / priors | YES | high | prediction-log stores | recompute on settle | Prediction Log, learner panels |"
  );
  lines.push(
    "| team id map (KV) | YES | high | `lib/football-api/team-id-map.ts` | resolve on API lookup | result trace |"
  );
  lines.push("");
  lines.push("## Additive layer (new — not protected legacy)");
  lines.push("");
  lines.push(
    "New tables use `core_*`, `analytics_*`, `audit_*` prefixes in `public`. They are empty or backfilled copies; pages must keep reading legacy until shadow compare passes."
  );
  lines.push("");
  lines.push("## Freeze checklist (ops)");
  lines.push("");
  lines.push("1. Neon backup + restore test on a branch DB.");
  lines.push("2. Capture row counts for all PG tables + KV `batchIndex` length.");
  lines.push("3. Record app version / git SHA at freeze.");
  lines.push("");

  mkdirSync(join(ROOT, "docs"), { recursive: true });
  writeFileSync(OUT_PATH, lines.join("\n"), "utf8");
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`Tables inventoried: ${tables.length}`);
  console.log(`Protected PG patterns: ${PROTECTED_PG.join(", ")}`);
}

main();
