import { center, mean, minimize } from "./optimizer";
import {
  outer,
  overUnderFromPmf,
  overUnderFromPoissonSum,
  poissonLogPmf,
  poissonPmf,
  trace,
  trilSum,
  triuSum,
} from "./poisson";
import type { BacktestMetricsResult, FitOptions, MatchRow, PredictionResult, PredictorOptions } from "./types";
import { expectedCalibrationError, reliabilityBins } from "./calibration";
import { withPromotedFallback } from "./promoted";
import { DEMO_LEAGUE_GROUPS } from "@/lib/data/demo-teams";
import {
  bttsFromMatrix,
  homeGoalsPmf,
  awayGoalsPmf,
  moreGoalsHalfFromMatrices,
  overUnderFromMatrix,
  scoreMatrixFromModel,
  totalGoalsPmf,
} from "./score-matrix";

function prepareMatchData(rows: MatchRow[]): MatchRow[] {
  const out = [...rows];
  if (out.some((r) => r.Date)) {
    out.sort((a, b) => {
      const da = parseDate(a.Date);
      const db = parseDate(b.Date);
      return da.getTime() - db.getTime();
    });
  }
  return out;
}

function parseDate(d?: string): Date {
  if (!d) return new Date(0);
  const parts = d.split(/[/-]/);
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    let year = parseInt(parts[2], 10);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    return new Date(year, month, day);
  }
  return new Date(d);
}

function computeTimeWeights(rows: MatchRow[], decayXi: number): number[] {
  const n = rows.length;
  if (decayXi <= 0 || n === 0) return Array(n).fill(1);

  let ageDays: number[];
  if (rows.some((r) => r.Date)) {
    const dates = rows.map((r) => parseDate(r.Date));
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
    ageDays = dates.map(
      (d) => (maxDate.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    );
  } else {
    ageDays = rows.map((_, i) => n - 1 - i);
  }

  const weights = ageDays.map((age) => Math.exp(-decayXi * age));
  const wMean = mean(weights);
  return weights.map((w) => w / wMean);
}

function tau(hg: number, ag: number, lam: number, mu: number, rho: number): number {
  if (hg === 0 && ag === 0) return Math.max(1 - lam * mu * rho, 1e-9);
  if (hg === 0 && ag === 1) return Math.max(1 + lam * rho, 1e-9);
  if (hg === 1 && ag === 0) return Math.max(1 + mu * rho, 1e-9);
  if (hg === 1 && ag === 1) return Math.max(1 - rho, 1e-9);
  return 1;
}

interface StrengthModel {
  teams: string[];
  attack: Record<string, number>;
  defence: Record<string, number>;
  homeAdv: number;
  base: number;
}

function fitPoissonStrength(
  rows: MatchRow[],
  homeCol: keyof MatchRow,
  awayCol: keyof MatchRow,
  weights: number[]
): StrengthModel {
  const teams = [...new Set(rows.flatMap((r) => [r.HomeTeam, r.AwayTeam]))].sort();
  const idx = Object.fromEntries(teams.map((t, i) => [t, i]));
  const n = teams.length;

  const h = rows.map((r) => idx[r.HomeTeam]);
  const a = rows.map((r) => idx[r.AwayTeam]);
  const hc = rows.map((r) => Number(r[homeCol]));
  const ac = rows.map((r) => Number(r[awayCol]));

  function unpack(p: number[]) {
    const base = p[0];
    const homeAdv = p[1];
    const atk = p.slice(2, 2 + n);
    const dfc = p.slice(2 + n, 2 + 2 * n);
    return { base, homeAdv, atk, dfc };
  }

  function negLogLike(p: number[]): number {
    const { base, homeAdv, atk, dfc } = unpack(p);
    const atkC = center(atk);
    const dfcC = center(dfc);
    let ll = 0;
    for (let i = 0; i < rows.length; i++) {
      const lamH = Math.exp(base + homeAdv + atkC[h[i]] - dfcC[a[i]]);
      const lamA = Math.exp(base + atkC[a[i]] - dfcC[h[i]]);
      ll += weights[i] * (poissonLogPmf(hc[i], lamH) + poissonLogPmf(ac[i], lamA));
    }
    return -ll;
  }

  const x0 = [
    Math.log(mean(hc) + 1e-6),
    0.1,
    ...Array(n).fill(0),
    ...Array(n).fill(0),
  ];
  const maxIter = Math.min(500, Math.max(60, Math.floor(4000 / Math.max(n, 1))));
  const res = minimize(negLogLike, x0, maxIter);
  const { base, homeAdv, atk, dfc } = unpack(res);
  const atkC = center(atk);
  const dfcC = center(dfc);

  return {
    teams,
    attack: Object.fromEntries(teams.map((t, i) => [t, atkC[i]])),
    defence: Object.fromEntries(teams.map((t, i) => [t, dfcC[i]])),
    homeAdv,
    base,
  };
}

function expectedStrength(
  model: StrengthModel,
  home: string,
  away: string
): [number, number] {
  const lamH = Math.exp(
    model.base + model.homeAdv + model.attack[home] - model.defence[away]
  );
  const lamA = Math.exp(model.base + model.attack[away] - model.defence[home]);
  return [lamH, lamA];
}

interface DixonColesModel {
  teams: string[];
  attack: Record<string, number>;
  defence: Record<string, number>;
  homeAdv: number;
  rho: number;
}

function fitDixonColes(rows: MatchRow[], weights: number[]): DixonColesModel {
  const teams = [...new Set(rows.flatMap((r) => [r.HomeTeam, r.AwayTeam]))].sort();
  const idx = Object.fromEntries(teams.map((t, i) => [t, i]));
  const n = teams.length;

  const h = rows.map((r) => idx[r.HomeTeam]);
  const a = rows.map((r) => idx[r.AwayTeam]);
  const hg = rows.map((r) => r.FTHG);
  const ag = rows.map((r) => r.FTAG);

  function unpack(p: number[]) {
    return {
      homeAdv: p[0],
      rho: p[1],
      atk: p.slice(2, 2 + n),
      dfc: p.slice(2 + n, 2 + 2 * n),
    };
  }

  function negLogLike(p: number[]): number {
    const { homeAdv, rho, atk, dfc } = unpack(p);
    const atkC = center(atk);
    const dfcC = center(dfc);
    let ll = 0;
    for (let i = 0; i < rows.length; i++) {
      const lam = Math.exp(homeAdv + atkC[h[i]] - dfcC[a[i]]);
      const mu = Math.exp(atkC[a[i]] - dfcC[h[i]]);
      const t = tau(hg[i], ag[i], lam, mu, rho);
      ll +=
        weights[i] *
        (Math.log(t) + poissonLogPmf(hg[i], lam) + poissonLogPmf(ag[i], mu));
    }
    return -ll;
  }

  const x0 = [0.25, -0.05, ...Array(n).fill(0), ...Array(n).fill(0)];
  const maxIter = Math.min(500, Math.max(60, Math.floor(4000 / Math.max(n, 1))));
  const res = minimize(negLogLike, x0, maxIter);
  const { homeAdv, rho, atk, dfc } = unpack(res);

  return {
    teams,
    attack: Object.fromEntries(teams.map((t, i) => [t, center(atk)[i]])),
    defence: Object.fromEntries(teams.map((t, i) => [t, center(dfc)[i]])),
    homeAdv,
    rho,
  };
}

function hasHtData(rows: MatchRow[], threshold = 0.8): boolean {
  if (!rows.length) return false;
  const withHt = rows.filter((r) => r.HTHG != null && r.HTAG != null).length;
  return withHt / rows.length >= threshold;
}

function toSecondHalfRows(rows: MatchRow[]): MatchRow[] {
  return rows
    .filter(
      (r) =>
        r.HTHG != null &&
        r.HTAG != null &&
        r.FTHG - r.HTHG >= 0 &&
        r.FTAG - r.HTAG >= 0
    )
    .map((r) => ({
      ...r,
      FTHG: r.FTHG - r.HTHG!,
      FTAG: r.FTAG - r.HTAG!,
    }));
}

function toHtRows(rows: MatchRow[]): MatchRow[] {
  return rows
    .filter((r) => r.HTHG != null && r.HTAG != null)
    .map((r) => ({
      ...r,
      FTHG: r.HTHG!,
      FTAG: r.HTAG!,
    }));
}

function hasThrowInsData(rows: MatchRow[], threshold = 0.8): boolean {
  if (!rows.length) return false;
  const withData = rows.filter((r) => r.HTI != null && r.ATI != null).length;
  return withData / rows.length >= threshold;
}

function actualOutcome(hg: number, ag: number): [number, number, number] {
  if (hg > ag) return [1, 0, 0];
  if (hg === ag) return [0, 1, 0];
  return [0, 0, 1];
}

export class FootballPredictor {
  private goals: DixonColesModel | null = null;
  private htGoals: DixonColesModel | null = null;
  private shGoals: DixonColesModel | null = null;
  private shotsModel: StrengthModel | null = null;
  private sotModel: StrengthModel | null = null;
  private offsidesModel: StrengthModel | null = null;
  private cornersModel: StrengthModel | null = null;
  private throwInsModel: StrengthModel | null = null;
  private trainingRows: MatchRow[] = [];
  private ouLines: number[];
  private teamOuLines: number[];
  private cornerOuLines: number[];
  private shotsOuLines: number[];
  private sotOuLines: number[];
  private throwInsOuLines: number[];
  private decayXi: number;
  private promotedFallback: boolean;

  constructor(
    ouLines: number[] = [1.5, 2.5, 3.5],
    decayXi = 0.002,
    teamOuLines: number[] = [0.5, 1.5, 2.5],
    cornerOuLines: number[] = [8.5, 9.5, 10.5],
    options?: PredictorOptions & {
      shotsOuLines?: number[];
      sotOuLines?: number[];
      throwInsOuLines?: number[];
    }
  ) {
    this.ouLines = ouLines;
    this.teamOuLines = teamOuLines;
    this.cornerOuLines = cornerOuLines;
    this.shotsOuLines = options?.shotsOuLines ?? [8.5, 10.5, 12.5];
    this.sotOuLines = options?.sotOuLines ?? [3.5, 4.5, 5.5];
    this.throwInsOuLines = options?.throwInsOuLines ?? [35.5, 38.5, 41.5];
    this.decayXi = decayXi;
    this.promotedFallback = options?.promotedFallback ?? false;
  }

  fit(rows: MatchRow[], options?: FitOptions): this {
    const includeAuxiliary = options?.includeAuxiliary ?? true;
    const df = prepareMatchData(rows);
    this.trainingRows = df;
    const weights = computeTimeWeights(df, this.decayXi);

    this.goals = fitDixonColes(df, weights);

    if (hasHtData(df)) {
      const htRows = toHtRows(df);
      const shRows = toSecondHalfRows(df);
      const htWeights = computeTimeWeights(htRows, this.decayXi);
      const shWeights = computeTimeWeights(shRows, this.decayXi);
      this.htGoals = fitDixonColes(htRows, htWeights);
      this.shGoals = fitDixonColes(shRows, shWeights);
    } else {
      this.htGoals = null;
      this.shGoals = null;
    }

    if (!includeAuxiliary) {
      this.shotsModel = null;
      this.sotModel = null;
      this.offsidesModel = null;
      this.cornersModel = null;
      this.throwInsModel = null;
      return this;
    }

    if (df.every((r) => r.HS != null && r.AS != null))
      this.shotsModel = fitPoissonStrength(df, "HS", "AS", weights);
    if (df.every((r) => r.HST != null && r.AST != null))
      this.sotModel = fitPoissonStrength(df, "HST", "AST", weights);
    if (df.every((r) => r.HO != null && r.AO != null))
      this.offsidesModel = fitPoissonStrength(df, "HO", "AO", weights);
    if (df.every((r) => r.HC != null && r.AC != null))
      this.cornersModel = fitPoissonStrength(df, "HC", "AC", weights);
    if (hasThrowInsData(df))
      this.throwInsModel = fitPoissonStrength(df, "HTI", "ATI", weights);
    else this.throwInsModel = null;

    return this;
  }

  get teams(): string[] {
    return this.goals?.teams ?? [];
  }

  predict(home: string, away: string): PredictionResult {
    if (!this.goals) throw new Error("Model not fitted");

    let goalsModel = this.goals;
    let warnings: string[] = [];

    if (this.promotedFallback) {
      const adjusted = withPromotedFallback(
        this.goals,
        home,
        away,
        this.trainingRows
      );
      goalsModel = adjusted.model;
      warnings = adjusted.warnings;
    } else if (
      !this.goals.teams.includes(home) ||
      !this.goals.teams.includes(away)
    ) {
      throw new Error(`Unknown team. Known: ${this.goals.teams.join(", ")}`);
    }

    const m = scoreMatrixFromModel(goalsModel, home, away);
    const pHome = trilSum(m, -1);
    const pDraw = trace(m);
    const pAway = triuSum(m, 1);

    let expH = 0;
    let expA = 0;
    for (let h = 0; h < m.length; h++) {
      for (let a = 0; a < m[h].length; a++) {
        expH += h * m[h][a];
        expA += a * m[h][a];
      }
    }

    const goalsOverUnder: Record<string, [number, number]> = {};
    for (const line of this.ouLines) {
      goalsOverUnder[String(line)] = overUnderFromMatrix(m, line);
    }

    const homePmf = homeGoalsPmf(m);
    const awayPmf = awayGoalsPmf(m);
    const homeGoalsOverUnder: Record<string, [number, number]> = {};
    const awayGoalsOverUnder: Record<string, [number, number]> = {};
    for (const line of this.teamOuLines) {
      homeGoalsOverUnder[String(line)] = overUnderFromPmf(homePmf, line);
      awayGoalsOverUnder[String(line)] = overUnderFromPmf(awayPmf, line);
    }

    const result: PredictionResult = {
      home,
      away,
      pHome,
      pDraw,
      pAway,
      expHomeGoals: expH,
      expAwayGoals: expA,
      goalsOverUnder,
      doubleChance: {
        oneX: pHome + pDraw,
        xTwo: pDraw + pAway,
        oneTwo: pHome + pAway,
      },
      btts: bttsFromMatrix(m),
      homeGoalsOverUnder,
      awayGoalsOverUnder,
    };

    if (this.htGoals && this.shGoals) {
      const canHt =
        this.htGoals.teams.includes(home) &&
        this.htGoals.teams.includes(away) &&
        this.shGoals.teams.includes(home) &&
        this.shGoals.teams.includes(away);

      if (canHt) {
        const mHt = scoreMatrixFromModel(this.htGoals, home, away);
        const mSh = scoreMatrixFromModel(this.shGoals, home, away);
        result.firstHalf = {
          pHome: trilSum(mHt, -1),
          pDraw: trace(mHt),
          pAway: triuSum(mHt, 1),
        };
        result.moreGoalsHalf = moreGoalsHalfFromMatrices(mHt, mSh);
        const pHtDraw = trace(mHt);
        const pShDraw = trace(mSh);
        result.drawAtLeastOneHalf = 1 - (1 - pHtDraw) * (1 - pShDraw);

        const pHomeNoWinHt = 1 - trilSum(mHt, -1);
        const pHomeNoWinSh = 1 - trilSum(mSh, -1);
        result.homeWinAtLeastOneHalf = 1 - pHomeNoWinHt * pHomeNoWinSh;

        const pAwayNoWinHt = 1 - triuSum(mHt, 1);
        const pAwayNoWinSh = 1 - triuSum(mSh, 1);
        result.awayWinAtLeastOneHalf = 1 - pAwayNoWinHt * pAwayNoWinSh;
      }
    }

    if (this.cornersModel) {
      if (
        this.cornersModel.teams.includes(home) &&
        this.cornersModel.teams.includes(away)
      ) {
        result.expCorners = expectedStrength(this.cornersModel, home, away);
        const cornersOverUnder: Record<string, [number, number]> = {};
        for (const line of this.cornerOuLines) {
          cornersOverUnder[String(line)] = overUnderFromPoissonSum(
            result.expCorners[0],
            result.expCorners[1],
            line
          );
        }
        result.cornersOverUnder = cornersOverUnder;
      }
    }

    if (this.shotsModel) {
      result.shots = expectedStrength(this.shotsModel, home, away);
      if (
        this.shotsModel.teams.includes(home) &&
        this.shotsModel.teams.includes(away)
      ) {
        const shotsOverUnder: Record<string, [number, number]> = {};
        for (const line of this.shotsOuLines) {
          shotsOverUnder[String(line)] = overUnderFromPoissonSum(
            result.shots[0],
            result.shots[1],
            line
          );
        }
        result.shotsOverUnder = shotsOverUnder;
      }
    }
    if (this.sotModel) {
      result.shotsOnTarget = expectedStrength(this.sotModel, home, away);
      if (
        this.sotModel.teams.includes(home) &&
        this.sotModel.teams.includes(away)
      ) {
        const sotOverUnder: Record<string, [number, number]> = {};
        for (const line of this.sotOuLines) {
          sotOverUnder[String(line)] = overUnderFromPoissonSum(
            result.shotsOnTarget![0],
            result.shotsOnTarget![1],
            line
          );
        }
        result.sotOverUnder = sotOverUnder;
      }
    }
    if (this.offsidesModel)
      result.offsides = expectedStrength(this.offsidesModel, home, away);

    if (this.throwInsModel) {
      if (
        this.throwInsModel.teams.includes(home) &&
        this.throwInsModel.teams.includes(away)
      ) {
        result.expThrowIns = expectedStrength(this.throwInsModel, home, away);
        const throwInsOverUnder: Record<string, [number, number]> = {};
        for (const line of this.throwInsOuLines) {
          throwInsOverUnder[String(line)] = overUnderFromPoissonSum(
            result.expThrowIns[0],
            result.expThrowIns[1],
            line
          );
        }
        result.throwInsOverUnder = throwInsOverUnder;
      }
    }

    if (warnings.length) result.warnings = warnings;

    return result;
  }

  backtest(
    rows: MatchRow[],
    testFraction = 0.2,
    minTrain = 50
  ): BacktestMetricsResult {
    const df = prepareMatchData(rows);
    const n = df.length;
    const nTest = Math.max(1, Math.floor(n * testFraction));
    const nTrain = n - nTest;

    if (nTrain < minTrain)
      throw new Error(
        `Not enough training data: ${nTrain} rows (min ${minTrain})`
      );

    const engine = new FootballPredictor(this.ouLines, this.decayXi);
    engine.fit(df.slice(0, nTrain));
    const testDf = df.slice(nTrain);

    let brierSum = 0;
    let logLossSum = 0;
    let correct = 0;
    let goalsErrSum = 0;
    const ouBrier: Record<string, number> = Object.fromEntries(
      this.ouLines.map((l) => [String(l), 0])
    );
    const shotsErr: number[] = [];
    const sotErr: number[] = [];
    const offErr: number[] = [];
    const cornerErr: number[] = [];
    let brierBttsSum = 0;
    let nEval = 0;
    const eps = 1e-15;
    const calib1x2Pred: number[] = [];
    const calib1x2Actual: number[] = [];
    const calibBttsPred: number[] = [];
    const calibBttsActual: number[] = [];

    for (const row of testDf) {
      const { HomeTeam: home, AwayTeam: away } = row;
      if (!engine.teams.includes(home) || !engine.teams.includes(away)) continue;

      nEval++;
      const pred = engine.predict(home, away);
      const hg = row.FTHG;
      const ag = row.FTAG;
      const probs: [number, number, number] = [pred.pHome, pred.pDraw, pred.pAway];
      const actual = actualOutcome(hg, ag);

      brierSum += probs.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0);
      const pActual = probs[0] * actual[0] + probs[1] * actual[1] + probs[2] * actual[2];
      logLossSum -= Math.log(Math.max(pActual, eps));

      const predIdx = probs.indexOf(Math.max(...probs));
      const actIdx = actual.indexOf(1);
      if (predIdx === actIdx) correct++;

      calib1x2Pred.push(Math.max(...probs));
      calib1x2Actual.push(predIdx === actIdx ? 1 : 0);

      const bttsActual = hg > 0 && ag > 0 ? 1 : 0;
      brierBttsSum += (pred.btts.yes - bttsActual) ** 2;
      calibBttsPred.push(pred.btts.yes);
      calibBttsActual.push(bttsActual);

      const actualTotal = hg + ag;
      goalsErrSum += Math.abs(pred.expHomeGoals + pred.expAwayGoals - actualTotal);

      for (const line of this.ouLines) {
        const [ov] = pred.goalsOverUnder[String(line)];
        const wentOver = actualTotal > line ? 1 : 0;
        ouBrier[String(line)] += (ov - wentOver) ** 2;
      }

      if (engine.shotsModel && row.HS != null && row.AS != null) {
        const [eh, ea] = expectedStrength(engine.shotsModel, home, away);
        shotsErr.push(Math.abs(eh + ea - (row.HS + row.AS)));
      }
      if (engine.sotModel && row.HST != null && row.AST != null) {
        const [eh, ea] = expectedStrength(engine.sotModel, home, away);
        sotErr.push(Math.abs(eh + ea - (row.HST + row.AST)));
      }
      if (engine.offsidesModel && row.HO != null && row.AO != null) {
        const [eh, ea] = expectedStrength(engine.offsidesModel, home, away);
        offErr.push(Math.abs(eh + ea - (row.HO + row.AO)));
      }
      if (engine.cornersModel && row.HC != null && row.AC != null) {
        const [eh, ea] = expectedStrength(engine.cornersModel, home, away);
        cornerErr.push(Math.abs(eh + ea - (row.HC + row.AC)));
      }
    }

    if (nEval === 0) throw new Error("No test fixtures could be evaluated");

    const calibration1x2 = reliabilityBins(calib1x2Pred, calib1x2Actual);
    const calibrationBtts = reliabilityBins(calibBttsPred, calibBttsActual);

    return {
      nTest: nEval,
      brier1x2: brierSum / nEval,
      logLoss1x2: logLossSum / nEval,
      accuracy1x2: correct / nEval,
      brierOu: Object.fromEntries(
        Object.entries(ouBrier).map(([k, v]) => [k, v / nEval])
      ),
      brierBtts: brierBttsSum / nEval,
      maeGoals: goalsErrSum / nEval,
      maeShots: shotsErr.length ? shotsErr.reduce((a, b) => a + b, 0) / shotsErr.length : undefined,
      maeSot: sotErr.length ? sotErr.reduce((a, b) => a + b, 0) / sotErr.length : undefined,
      maeOffsides: offErr.length ? offErr.reduce((a, b) => a + b, 0) / offErr.length : undefined,
      maeCorners: cornerErr.length ? cornerErr.reduce((a, b) => a + b, 0) / cornerErr.length : undefined,
      calibration1x2,
      calibrationBtts,
      ece1x2: expectedCalibrationError(calibration1x2),
      eceBtts: expectedCalibrationError(calibrationBtts),
    };
  }
}

export function makeDemoData(seed = 7, nSeasons = 1): MatchRow[] {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const randn = () => {
    const u = rand() || 1e-10;
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const poisson = (lam: number) => {
    const L = Math.exp(-lam);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rand();
    } while (p > L);
    return k - 1;
  };

  const allTeams = [
    ...new Set(DEMO_LEAGUE_GROUPS.flatMap((g) => g.teams)),
  ];
  const strength = Object.fromEntries(allTeams.map((t) => [t, randn() * 0.35]));
  const rows: MatchRow[] = [];
  const matchesPerDay = 6;

  const demoYear = (dateStr?: string) => {
    if (!dateStr) return 0;
    const parts = dateStr.split(/[/-]/);
    if (parts.length !== 3) return 0;
    let year = parseInt(parts[2], 10);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    return year;
  };

  const formatDate = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
  };

  for (let season = 0; season < nSeasons; season++) {
    const seasonStart = new Date(2025 + season, 7, 1);

    for (const group of DEMO_LEAGUE_GROUPS) {
      let localIdx = 0;
      for (const h of group.teams) {
        for (const a of group.teams) {
          if (h === a) continue;
          const lam = Math.exp(0.25 + strength[h] - strength[a] * 0.8);
          const mu = Math.exp(strength[a] - strength[h] * 0.8);
          const d = new Date(seasonStart);
          d.setDate(d.getDate() + Math.floor(localIdx / matchesPerDay));
          const fthg = poisson(lam);
          const ftag = poisson(mu);
          const hthg = Math.min(poisson(lam * 0.45), fthg);
          const htag = Math.min(poisson(mu * 0.45), ftag);
          rows.push({
            Date: formatDate(d),
            HomeTeam: h,
            AwayTeam: a,
            FTHG: fthg,
            FTAG: ftag,
            HTHG: hthg,
            HTAG: htag,
            HS: poisson(12 + 4 * strength[h]),
            AS: poisson(10 + 4 * strength[a]),
            HST: poisson(5 + 2 * strength[h]),
            AST: poisson(4 + 2 * strength[a]),
            HO: poisson(2.2),
            AO: poisson(2.0),
            HC: poisson(5 + strength[h]),
            AC: poisson(4 + strength[a]),
          });
          localIdx++;
        }
      }
    }
  }

  return rows.filter((row) => demoYear(row.Date) >= 2025);
}

export function rowsToMatches(rows: MatchRow[]) {
  return rows;
}
