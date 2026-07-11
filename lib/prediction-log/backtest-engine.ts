/**
 * Walk-forward backtest of the live recommendation / computeMasterProbability path.
 */

import {
  applyMatchResultToClubs,
  batchesStrictlyBefore,
  buildAsOfRecommendationContext,
  clubRecordsMap,
  createAsOfRegistry,
  enrichMatchActuals,
  extractFtGoals,
  resolveAsOfClub,
  type AsOfClubRegistry,
} from "./backtest-asof";
import { analyzeCorrectScore } from "./correct-score";
import { scoreGridForMatch } from "./correct-score-freeze";
import { computeMasterProbability } from "./master-probability";
import { computeLeagueBaselines } from "./league-baselines";
import { isValidOdds } from "./odds-bands";
import type { ClubRecord } from "./club-record-types";
import type { LogMatch, MarketPrediction, PredictionBatch } from "./types";
import type { RecommendationContext } from "./recommendation-context";
import type { TeamsQualityStore } from "./teams-quality-types";
import type { MlClassifierStore } from "./ml-model-store";
import {
  expectedCalibrationError,
  reliabilityBins,
} from "@/lib/predictor/calibration";

export type RecoBacktestMode =
  | "full"
  | "rolling_3"
  | "rolling_6"
  | "rolling_12"
  | "custom";

export interface RecoBacktestConfig {
  mode: RecoBacktestMode;
  leagues?: string[];
  dateFrom?: string;
  dateTo?: string;
  /** Max matches warning threshold (default 800). */
  warnAbove?: number;
}

export interface RecoBacktestMatchRow {
  date: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  batchId: string;
  matchId: string;
  hg: number;
  ag: number;
  pick1x2: string;
  p1x2: number;
  hit1x2: boolean;
  brier1x2: number;
  probs1x2: { home: number; draw: number; away: number };
  pickOu25: "over" | "under";
  pOu25: number;
  hitOu25: boolean;
  pickBtts: "yes" | "no";
  pBtts: number;
  hitBtts: boolean;
  csPick: string | null;
  csHit: boolean | null;
  valueEligible: boolean;
  valueHit: boolean | null;
  stakeOdds: number | null;
  roiUnit: number | null;
}

export interface MarketAccuracySummary {
  n: number;
  hits: number;
  accuracy: number | null;
}

export interface RecoBacktestSummary {
  nMatches: number;
  oneX2: MarketAccuracySummary & { brier: number | null; ece: number | null };
  ou25: MarketAccuracySummary;
  btts: MarketAccuracySummary;
  correctScore: MarketAccuracySummary;
  value: MarketAccuracySummary;
  roi: { n: number; totalProfit: number; roiPct: number | null };
}

export interface RecoBacktestResult {
  id: string;
  createdAt: string;
  config: RecoBacktestConfig;
  warning?: string;
  summary: RecoBacktestSummary;
  byLeague: Record<
    string,
    {
      n: number;
      oneX2: number | null;
      ou25: number | null;
      btts: number | null;
    }
  >;
  byMarket: {
    "1x2": MarketAccuracySummary;
    ou25: MarketAccuracySummary;
    btts: MarketAccuracySummary;
    correctScore: MarketAccuracySummary;
  };
  monthly: Array<{
    month: string;
    n: number;
    hits: number;
    hitRate: number | null;
    cumulativeHitRate: number | null;
  }>;
  top: RecoBacktestMatchRow[];
  worst: RecoBacktestMatchRow[];
  rows: RecoBacktestMatchRow[];
}

export interface SettledBacktestMatch {
  batch: PredictionBatch;
  match: LogMatch;
  date: string;
  league: string;
  hg: number;
  ag: number;
}

const OU_LINE = 2.5;

function acc(hits: number, n: number): number | null {
  if (n <= 0) return null;
  return Math.round((hits / n) * 1000) / 10;
}

function monthsAgoIso(months: number, from = new Date()): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export function resolveDateWindow(
  config: RecoBacktestConfig,
  today = new Date()
): { dateFrom?: string; dateTo?: string } {
  if (config.mode === "custom") {
    return { dateFrom: config.dateFrom, dateTo: config.dateTo };
  }
  if (config.mode === "rolling_3") {
    return { dateFrom: monthsAgoIso(3, today) };
  }
  if (config.mode === "rolling_6") {
    return { dateFrom: monthsAgoIso(6, today) };
  }
  if (config.mode === "rolling_12") {
    return { dateFrom: monthsAgoIso(12, today) };
  }
  return {};
}

export function collectSettledMatches(
  batches: PredictionBatch[],
  config: RecoBacktestConfig,
  today = new Date()
): SettledBacktestMatch[] {
  const { dateFrom, dateTo } = resolveDateWindow(config, today);
  const leagueFilter =
    config.leagues && config.leagues.length > 0
      ? new Set(config.leagues)
      : null;

  const out: SettledBacktestMatch[] = [];
  for (const batch of batches) {
    if (leagueFilter && !leagueFilter.has(batch.league)) continue;
    if (dateFrom && batch.date < dateFrom) continue;
    if (dateTo && batch.date > dateTo) continue;

    for (const raw of batch.matches) {
      const match = enrichMatchActuals(raw);
      const goals = extractFtGoals(match);
      if (!goals) continue;
      out.push({
        batch,
        match,
        date: batch.date,
        league: batch.league,
        hg: goals.hg,
        ag: goals.ag,
      });
    }
  }

  out.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const bcmp = a.batch.id.localeCompare(b.batch.id);
    if (bcmp !== 0) return bcmp;
    return a.match.id.localeCompare(b.match.id);
  });
  return out;
}

function blankPred(prediction: string, line?: number): MarketPrediction {
  return { prediction, line, confidence: 50 };
}

function argmaxPSignal(
  ctx: RecommendationContext,
  match: LogMatch,
  marketKey: "1x2" | "btts" | "home_goals_ou",
  candidates: Array<{ prediction: string; line?: number }>
): { prediction: string; line?: number; pSignal: number } {
  let best = {
    prediction: candidates[0]!.prediction,
    line: candidates[0]!.line,
    pSignal: -1,
  };
  for (const c of candidates) {
    const mp = computeMasterProbability(
      ctx,
      match,
      marketKey,
      blankPred(c.prediction, c.line)
    );
    if (mp.pSignal > best.pSignal) {
      best = { prediction: c.prediction, line: c.line, pSignal: mp.pSignal };
    }
  }
  return best;
}

function normalizeTriplet(
  home: number,
  draw: number,
  away: number
): { home: number; draw: number; away: number } {
  const h = Math.max(0, home) / 100;
  const d = Math.max(0, draw) / 100;
  const a = Math.max(0, away) / 100;
  const sum = h + d + a || 1;
  return { home: h / sum, draw: d / sum, away: a / sum };
}

function brier1x2(
  probs: { home: number; draw: number; away: number },
  actual: "home" | "draw" | "away"
): number {
  const y = {
    home: actual === "home" ? 1 : 0,
    draw: actual === "draw" ? 1 : 0,
    away: actual === "away" ? 1 : 0,
  };
  return (
    (probs.home - y.home) ** 2 +
    (probs.draw - y.draw) ** 2 +
    (probs.away - y.away) ** 2
  );
}

function actual1x2(hg: number, ag: number): "home" | "draw" | "away" {
  if (hg > ag) return "home";
  if (ag > hg) return "away";
  return "draw";
}

function loggedOddsForPick(
  match: LogMatch,
  market: "1x2" | "btts" | "home_goals_ou",
  prediction: string,
  line?: number
): number | null {
  const pred = match.predictions[market];
  if (!pred || !isValidOdds(pred.odds)) return null;
  if (pred.prediction.toLowerCase() !== prediction.toLowerCase()) return null;
  if (line != null && pred.line != null && pred.line !== line) return null;
  return pred.odds!;
}

function scoreRowQuality(row: RecoBacktestMatchRow): number {
  // Higher = better prediction (for top list)
  let s = 0;
  if (row.hit1x2) s += row.p1x2;
  else s -= 100 - row.p1x2;
  if (row.hitOu25) s += row.pOu25 * 0.5;
  else s -= (100 - row.pOu25) * 0.5;
  if (row.hitBtts) s += row.pBtts * 0.5;
  else s -= (100 - row.pBtts) * 0.5;
  return s;
}

function summarizeRows(rows: RecoBacktestMatchRow[]): RecoBacktestSummary {
  let hit1 = 0;
  let brierSum = 0;
  let hitOu = 0;
  let hitBtts = 0;
  let csN = 0;
  let csHits = 0;
  let valueN = 0;
  let valueHits = 0;
  let roiN = 0;
  let roiProfit = 0;
  const calibPred: number[] = [];
  const calibActual: number[] = [];

  for (const r of rows) {
    if (r.hit1x2) hit1++;
    brierSum += r.brier1x2;
    calibPred.push(r.p1x2 / 100);
    calibActual.push(r.hit1x2 ? 1 : 0);
    if (r.hitOu25) hitOu++;
    if (r.hitBtts) hitBtts++;
    if (r.csHit != null) {
      csN++;
      if (r.csHit) csHits++;
    }
    if (r.valueEligible && r.valueHit != null) {
      valueN++;
      if (r.valueHit) valueHits++;
    }
    if (r.roiUnit != null && r.stakeOdds != null) {
      roiN++;
      roiProfit += r.roiUnit;
    }
  }

  const n = rows.length;
  const bins = reliabilityBins(calibPred, calibActual, 10);
  const ece = n > 0 ? expectedCalibrationError(bins) : null;

  return {
    nMatches: n,
    oneX2: {
      n,
      hits: hit1,
      accuracy: acc(hit1, n),
      brier: n > 0 ? Math.round((brierSum / n) * 10000) / 10000 : null,
      ece: ece != null ? Math.round(ece * 1000) / 1000 : null,
    },
    ou25: { n, hits: hitOu, accuracy: acc(hitOu, n) },
    btts: { n, hits: hitBtts, accuracy: acc(hitBtts, n) },
    correctScore: { n: csN, hits: csHits, accuracy: acc(csHits, csN) },
    value: { n: valueN, hits: valueHits, accuracy: acc(valueHits, valueN) },
    roi: {
      n: roiN,
      totalProfit: Math.round(roiProfit * 100) / 100,
      roiPct: roiN > 0 ? Math.round((roiProfit / roiN) * 1000) / 10 : null,
    },
  };
}

function predictOneMatch(
  item: SettledBacktestMatch,
  registry: AsOfClubRegistry,
  allBatches: PredictionBatch[],
  extras: {
    teamsQuality: TeamsQualityStore | null;
    mlClassifier: MlClassifierStore | null;
  }
): RecoBacktestMatchRow {
  const { batch, match: rawMatch, date, league, hg, ag } = item;
  const home = resolveAsOfClub(
    registry,
    rawMatch.homeTeam,
    league,
    rawMatch.homeClubId
  );
  const away = resolveAsOfClub(
    registry,
    rawMatch.awayTeam,
    league,
    rawMatch.awayClubId
  );

  const match: LogMatch = {
    ...enrichMatchActuals(rawMatch),
    homeClubId: home.clubId,
    awayClubId: away.clubId,
  };

  const priorBatches = batchesStrictlyBefore(allBatches, date);
  const clubRecords = clubRecordsMap(registry);
  const leagueBaselines = computeLeagueBaselines(priorBatches);
  const ctx = buildAsOfRecommendationContext({
    league,
    batchesBefore: priorBatches,
    clubRecords,
    clubIndex: registry.index,
    leagueBaselines,
    teamsQuality: extras.teamsQuality,
    mlClassifier: extras.mlClassifier,
  });

  const pHome = computeMasterProbability(
    ctx,
    match,
    "1x2",
    blankPred("home")
  ).pSignal;
  const pDraw = computeMasterProbability(
    ctx,
    match,
    "1x2",
    blankPred("draw")
  ).pSignal;
  const pAway = computeMasterProbability(
    ctx,
    match,
    "1x2",
    blankPred("away")
  ).pSignal;
  const probs = normalizeTriplet(pHome, pDraw, pAway);
  const pick1x2 =
    pHome >= pDraw && pHome >= pAway
      ? "home"
      : pAway >= pDraw
        ? "away"
        : "draw";
  const p1x2 =
    pick1x2 === "home" ? pHome : pick1x2 === "away" ? pAway : pDraw;
  const actual = actual1x2(hg, ag);
  const hit1x2 = pick1x2 === actual;

  const ouPick = argmaxPSignal(ctx, match, "home_goals_ou", [
    { prediction: "over", line: OU_LINE },
    { prediction: "under", line: OU_LINE },
  ]);
  const total = hg + ag;
  const hitOu25 =
    ouPick.prediction === "over" ? total > OU_LINE : total < OU_LINE;

  const bttsPick = argmaxPSignal(ctx, match, "btts", [
    { prediction: "yes" },
    { prediction: "no" },
  ]);
  const actualBtts = hg > 0 && ag > 0 ? "yes" : "no";
  const hitBtts = bttsPick.prediction === actualBtts;

  let csPick: string | null = null;
  let csHit: boolean | null = null;
  const grid = scoreGridForMatch(
    match,
    league,
    clubRecords,
    registry.index,
    priorBatches
  );
  if (grid) {
    const cs = analyzeCorrectScore(grid);
    if (cs) {
      csPick = `${cs.mostLikely.home}-${cs.mostLikely.away}`;
      csHit =
        cs.mostLikely.home === hg && cs.mostLikely.away === ag;
    }
  }

  const stakeOdds = loggedOddsForPick(match, "1x2", pick1x2);
  let valueEligible = false;
  let valueHit: boolean | null = null;
  let roiUnit: number | null = null;
  if (stakeOdds != null) {
    const edge = p1x2 / 100 - 1 / stakeOdds;
    if (edge > 0) {
      valueEligible = true;
      valueHit = hit1x2;
    }
    roiUnit = hit1x2 ? stakeOdds - 1 : -1;
  }

  return {
    date,
    league,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    batchId: batch.id,
    matchId: match.id,
    hg,
    ag,
    pick1x2,
    p1x2,
    hit1x2,
    brier1x2: brier1x2(probs, actual),
    probs1x2: probs,
    pickOu25: ouPick.prediction as "over" | "under",
    pOu25: ouPick.pSignal,
    hitOu25,
    pickBtts: bttsPick.prediction as "yes" | "no",
    pBtts: bttsPick.pSignal,
    hitBtts,
    csPick,
    csHit,
    valueEligible,
    valueHit,
    stakeOdds,
    roiUnit,
  };
}

function applyPending(
  pending: SettledBacktestMatch[],
  registry: AsOfClubRegistry,
  teamsQuality: TeamsQualityStore | null
): void {
  for (const item of pending) {
    const home = resolveAsOfClub(
      registry,
      item.match.homeTeam,
      item.league,
      item.match.homeClubId
    );
    const away = resolveAsOfClub(
      registry,
      item.match.awayTeam,
      item.league,
      item.match.awayClubId
    );
    const { home: h2, away: a2 } = applyMatchResultToClubs(
      home,
      away,
      item.match,
      { batchId: item.batch.id, date: item.date },
      null,
      teamsQuality
    );
    registry.clubs.set(h2.clubId, h2);
    registry.clubs.set(a2.clubId, a2);
  }
}

export interface RunRecoBacktestOptions {
  batches: PredictionBatch[];
  config: RecoBacktestConfig;
  teamsQuality?: TeamsQualityStore | null;
  mlClassifier?: MlClassifierStore | null;
  /** Injected for tests — pre-seeded club registry. */
  registry?: AsOfClubRegistry;
  today?: Date;
  runId?: string;
}

export function runRecoBacktest(
  opts: RunRecoBacktestOptions
): RecoBacktestResult {
  const config = opts.config;
  const settled = collectSettledMatches(
    opts.batches,
    config,
    opts.today ?? new Date()
  );
  const registry = opts.registry ?? createAsOfRegistry();
  const extras = {
    teamsQuality: opts.teamsQuality ?? null,
    mlClassifier: opts.mlClassifier ?? null,
  };

  const rows: RecoBacktestMatchRow[] = [];
  let pending: SettledBacktestMatch[] = [];
  let currentDate: string | null = null;

  for (const item of settled) {
    if (currentDate != null && item.date !== currentDate) {
      applyPending(pending, registry, extras.teamsQuality);
      pending = [];
    }
    currentDate = item.date;
    rows.push(predictOneMatch(item, registry, opts.batches, extras));
    pending.push(item);
  }
  if (pending.length) {
    applyPending(pending, registry, extras.teamsQuality);
  }

  const summary = summarizeRows(rows);

  const leagueHits = new Map<
    string,
    { n: number; oneX2Hits: number; ouHits: number; bttsHits: number }
  >();
  for (const r of rows) {
    const bucket = leagueHits.get(r.league) ?? {
      n: 0,
      oneX2Hits: 0,
      ouHits: 0,
      bttsHits: 0,
    };
    bucket.n++;
    if (r.hit1x2) bucket.oneX2Hits++;
    if (r.hitOu25) bucket.ouHits++;
    if (r.hitBtts) bucket.bttsHits++;
    leagueHits.set(r.league, bucket);
  }
  const byLeagueOut: RecoBacktestResult["byLeague"] = {};
  for (const [league, b] of leagueHits) {
    byLeagueOut[league] = {
      n: b.n,
      oneX2: acc(b.oneX2Hits, b.n),
      ou25: acc(b.ouHits, b.n),
      btts: acc(b.bttsHits, b.n),
    };
  }

  const monthMap = new Map<string, { n: number; hits: number }>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const m = monthMap.get(month) ?? { n: 0, hits: 0 };
    m.n++;
    if (r.hit1x2) m.hits++;
    monthMap.set(month, m);
  }
  const monthlySorted = [...monthMap.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  let cumN = 0;
  let cumHits = 0;
  const monthly = monthlySorted.map(([month, m]) => {
    cumN += m.n;
    cumHits += m.hits;
    return {
      month,
      n: m.n,
      hits: m.hits,
      hitRate: acc(m.hits, m.n),
      cumulativeHitRate: acc(cumHits, cumN),
    };
  });

  const ranked = [...rows].sort(
    (a, b) => scoreRowQuality(b) - scoreRowQuality(a)
  );
  const topN = 10;

  const warnAbove = config.warnAbove ?? 800;
  const warning =
    settled.length > warnAbove
      ? `Large universe (${settled.length} matches). Run may approach the platform time limit.`
      : undefined;

  const createdAt = new Date().toISOString();
  return {
    id: opts.runId ?? `btr_${createdAt.replace(/[:.]/g, "-")}`,
    createdAt,
    config,
    warning,
    summary,
    byLeague: byLeagueOut,
    byMarket: {
      "1x2": {
        n: summary.oneX2.n,
        hits: summary.oneX2.hits,
        accuracy: summary.oneX2.accuracy,
      },
      ou25: summary.ou25,
      btts: summary.btts,
      correctScore: summary.correctScore,
    },
    monthly,
    top: ranked.slice(0, topN),
    worst: ranked.slice(-topN).reverse(),
    rows,
  };
}

/** Rebuild clubs map as-of for unit tests / diagnostics. */
export function peekClubSampleSize(
  record: ClubRecord | null | undefined
): number {
  return record?.capacity?.sampleSize ?? 0;
}
