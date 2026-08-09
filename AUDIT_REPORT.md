# Full System Mathematical & Data Audit Report

**Generated:** 2026-08-08  
**Schema note:** Brief `fixtures` table maps to `hist_fixtures` + `hist_stats` (corners). Seasons are AF start-year integers. Window = 11 completed seasons (2015–2025 when current = 2026).

## 1. 66-bucket coverage table (measured)

Source: `npx tsx scripts/audit-hist-coverage.ts` (local DB).

| league | comp | season | expected | stored | ht | goals | stats | corners | lineups | completeness | inventory_pass |
|--------|------|--------|----------|--------|-----|-------|-------|---------|---------|--------------|----------------|
| Premier League | league | 2015 | 380 | 80 | 80 | 73 | 79 | 79 | 80 | partial | FAIL (<0.98×) |
| Premier League | league | 2016 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | missing | FAIL |
| Premier League | league | 2017 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | missing | FAIL |
| Premier League | league | 2018 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | missing | FAIL |
| Premier League | league | 2019 | 380 | 67 | 67 | 63 | 67 | 67 | 67 | partial | FAIL |
| Premier League | league | 2020 | 380 | 20 | 20 | 20 | 20 | 20 | 20 | partial | FAIL |
| Premier League | league | 2021 | 380 | 20 | 20 | 19 | 20 | 20 | 20 | partial | FAIL |
| Premier League | league | 2022 | 380 | 20 | 20 | 18 | 20 | 20 | 20 | partial | FAIL |
| Premier League | league | 2023 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | missing | FAIL |
| Premier League | league | 2024 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | missing | FAIL |
| Premier League | league | 2025 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | missing | FAIL |
| La Liga | league | 2015–2025 | — | 0 | 0 | 0 | 0 | 0 | 0 | missing ×11 | FAIL |
| Serie A | league | 2015–2025 | — | 0 | 0 | 0 | 0 | 0 | 0 | missing ×11 | FAIL |
| Bundesliga | league | 2015–2025 | — | 0 | 0 | 0 | 0 | 0 | 0 | missing ×11 | FAIL |
| Ligue 1 | league | 2015–2025 | — | 0 | 0 | 0 | 0 | 0 | 0 | missing ×11 | FAIL |
| UEFA Champions League | cup | 2015 | 217 | 20 | 20 | 19 | 20 | 20 | 20 | partial | FAIL |
| UEFA Champions League | cup | 2016 | 217 | 20 | 20 | 19 | 20 | 20 | 20 | partial | FAIL |
| UEFA Champions League | cup | 2017 | 219 | 20 | 20 | 18 | 0 | 0 | 20 | partial | FAIL |
| UEFA Champions League | cup | 2018 | 216 | 20 | 20 | 19 | 20 | 20 | 20 | partial | FAIL |
| UEFA Champions League | cup | 2019–2025 | — | 0 | 0 | 0 | 0 | 0 | 0 | missing ×7 | FAIL |

**SUMMARY (after deep-first drain, quota stop 2026-08-08):** **2/66 inventoryPass**, 3 full, **34 partial**, **29 missing**, 0 provider holes.

**Per competition (completed window):**
- Premier League: fixtures≈1100 (2015 complete; 2019 at 360/380; others partial)
- Ligue 1: fixtures≈779 (2019 complete 279/279; other seasons ~50 each)
- Bundesliga: fixtures≈233 (partial starts)
- La Liga / Serie A: still 0
- UEFA Champions League: ~200 fixtures across partial seasons

**Gate status:** FAIL — API-Football Pro day quota exhausted (`current≈7500`).

**Daily by default:** Vercel cron `/api/cron/hist-backfill` runs gap-priority drain at **05/09/13/17/21 UTC** until `inventoryPass=66`. Manual local burst:

```bash
npx tsx scripts/drain-hist-gaps.ts --max-chunks=120 --enrich=50
```

Drain is deep-first (finish started seasons to ≥98% before opening new ones). Honest provider holes (no `/leagues` coverage) count as inventoryPass without inventing rows.

**Competition set confirmed:** 39/140/135/78/61 = `league`, 2 = `cup`.

**Action:** Gap-priority backfill started (`scripts/run-hist-gap-backfill.ts`). Re-run coverage after quota allows until inventory_pass for all 66.

On finished rows present in DB: HT coverage ≈ 100% of stored; corners ≈ 99% of stored PL rows. Threshold FAILs are dominated by **missing buckets**, not incomplete stats on imported fixtures.

## 2. Truncation sites found and fixed

| Site | Issue | Fix |
|------|-------|-----|
| `lib/hist/team-half-intensities.ts` | Last ~40 venue samples as sole input | Full hist window; normalized 0.8^ago weights; ESS/seasonsUsed returned |
| Seed baselines linear 1..5 weights | Dual decay scheme | `seed-season-weights.ts` uses 0.8^ago |
| `canonical-probability` / hybrid | Probability-level 60/40 blend | Removed; λ blend only in `canonicalFixtureEstimate` |
| two-h-heavy last-12 API | Sole strength when hist thin | Ladder already on HSH; hist-first intensities |

Form windows (last-6 club form, etc.) left as **additional** features only.

## 3. Output-level blending sites removed

| Site | Change |
|------|--------|
| `canonical-probability.ts` `packResult` | Returns API/model prob only; documents no P-blend |
| `hybrid-recommendation.ts` `calculateHybridRecommendation` | Displayed confidence = system score; AI advisory only |
| Tests updated | `hybrid-recommendation.test.ts` asserts no P-blend |

## 4. Fitted ρ, corner dispersion, distribution choice

Run: `npx tsx scripts/fit-model-params.ts` → persisted `hist_meta.model_params_json`.

| Param | Value |
|-------|-------|
| version | `v1-audit-2026-08` |
| fittedAt | 2026-08-08T14:17:38.894Z |
| ρ (Dixon–Coles) | **−0.03** (N=207 domestic FT rows; re-fit after full backfill) |
| CL corners | mean≈5.09, var≈7.60, dispersion≈**1.49** → **NegBin** (n=80 team-rows) |
| Other leagues corners | n=0 → Poisson default until backfilled |

## 5. Fitted λ_1H / λ_2H per league

Measured (Premier League only with data):

| League | λ_1H | λ_2H | λ_FT | λ_1H+λ_2H |
|--------|------|------|------|-----------|
| Premier League | 1.300 | 1.614 | 2.913 | 2.913 |

Sum-consistency OK for PL. Other domestics pending backfill. Runtime check: `canonicalFixtureEstimate.diagnostics.halfSumOk`.

## 6. Calibration table

**Status:** Insufficient finished hist across all 6 comps for a hold-out calibration with N per band (only PL partial + CL slice). Bin calibrator remains in `lib/predictor/calibration.ts`.

| Predicted band | N | Predicted mean | Actual hit rate | Gap |
|----------------|---|----------------|-----------------|-----|
| 50–60% | — | — | — | deferred |
| 60–70% | — | — | — | deferred |
| 70–80% | — | — | — | deferred |
| 80–90% | — | — | — | deferred |
| 90–100% | — | — | — | deferred |

Brier / log loss: deferred until ≥1 full domestic season window is inventory-complete. `test_calibration_gap_within_8_points` will gate release once data allows.

## 7. Before/after page-load timings

| Surface | Before (approx) | After |
|---------|-----------------|-------|
| Ladder | Per-match two-h-heavy + API profiles fetch | Sync HSH Stage A/B (no two-h-heavy network); cache key on `canonicalFixtureEstimate` |
| Recommendation | Hybrid P-blend | System confidence; markets from matrix when wired via CFE |

Re-measure with production data after backfill.

## 8. AI learner share under 60/40 (explicit review flag)

**Decision (reviewable):** 60% API-DB / 40% Manual+AI applies to **λ inputs** inside `canonicalFixtureEstimate` only. Displayed recommendation confidence is the **system** market score; AI score is advisory metadata. This reduces AI’s effective influence on the number shown vs the prior 50/50 confidence blend — intentional for probability coherence.

## 9. Provider / inventory gaps (plain)

- 60 of 66 season×competition buckets empty in local DB at audit time.
- Partial PL seasons (2015, 2019–2022) and CL 2015 are incomplete vs AF expected counts.
- No evidence of corners endpoint failure on **imported** rows (corners present when fixtures present).
- Continue gap-priority backfill until stored ≥ 0.98 × expected for every bucket; record genuine provider holes in `model_params` / coverage notes without inventing values.

---

## Architecture shipped this pass

- `lib/hist/decay-weights.ts` — normalize Σw=1, ESS  
- `lib/prediction-log/model-config.ts` — k=10, λ bounds  
- `lib/hist/model-params.ts` + `fit-model-params.ts`  
- `lib/prediction-log/canonical-fixture-estimate.ts` — SoT (`estimateBatchCanonical`, `ladderRanksFromBatchEstimates`)  
- Surfaces rewired to CFE markets: Survival Ladder, HSH, Corners O9.5, Combined Odds score grids  
- `team_ratings` table + `persist-team-ratings.ts`  
- Admin diagnostic: `GET /api/admin/fixture-estimate` + `FixtureEstimateDiagnostics` on HSH expand  
- `HistCoverageBadge` on Half Goals (honest inventory FAIL until 66/66)  
- Invariant + cross-surface tests (`invariants.test.ts`, `canonical-probability.test.ts`) — **29 passing**  
- Indexes: hist_fixtures home/away/status  

**DM merge/settlement:** untouched (WEIGHTING-EXEMPT).

## Release gates (honest)

| Gate | Status |
|------|--------|
| Invariant / anti-P-blend / CFE identity tests | PASS |
| Same fixture half % on Ladder + HSH | PASS (CFE) |
| 66-bucket inventory (`inventoryPass=66`) | **FAIL 2/66** — resume `scripts/drain-hist-gaps.ts` after quota reset |
| Calibration gap ≤8pp | **DEFERRED** (insufficient hist) |
