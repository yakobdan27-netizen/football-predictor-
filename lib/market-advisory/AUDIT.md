# MSAM Audit — Market Selection Advisory Model

Internal reference for Phase 1 audit. No user-facing behavior documented here changes legacy flows.

## Market code map

| LogMarketKey (DM) | MarketFamilyId (CFE/Slip) | MSAM market_code | MSAM conflict_group |
|---|---|---|---|
| `1x2` | RESULT_1X2 | `RESULT_1X2:home\|draw\|away` | RESULT_MARGIN |
| `double_chance` | DOUBLE_CHANCE | `DOUBLE_CHANCE:1X\|X2\|12` | RESULT_MARGIN |
| `handicap` | HANDICAP | `HANDICAP:home_*\|away_*` | RESULT_MARGIN |
| `total_goals_ou` | TOTALS | `TOTALS:over_*\|under_*` | TOTAL_GOALS |
| `home_goals_ou` | TEAM_GOALS | `TEAM_GOALS:home_*` | TEAM_GOALS |
| `away_goals_ou` | TEAM_GOALS | `TEAM_GOALS:away_*` | TEAM_GOALS |
| `btts` | BTTS | `BTTS:yes\|no` | BTTS_GOALS |
| `ht_1x2` | HT_RESULT | `HT_RESULT:home\|draw\|away` | HALF_STRUCTURE |
| `more_goals_half` | HSH | `HSH:1h\|2h\|tie` | HALF_STRUCTURE |
| `draw_one_half` | DIEH | `DIEH:yes\|no` | HALF_STRUCTURE |
| `win_one_half` | WIN_ONE_HALF | `WIN_ONE_HALF:home\|away` | HALF_STRUCTURE |
| `corners_ou` | CORNERS | `CORNERS:over_*\|under_*` | CORNERS |
| `sot_ou` / `home_sot_ou` / `away_sot_ou` | SOT | `SOT:*` | CORNERS |
| (combo pages) | COMBO | `COMBO:<comboId>` | COMBO |

Slip-builder G1–G4 maps to MSAM conflict groups:

- G1 → RESULT_MARGIN
- G2 TOTALS → TOTAL_GOALS; G2 TEAM_GOALS → TEAM_GOALS
- G3 → HALF_STRUCTURE
- G4 BTTS → BTTS_GOALS; G4 CORNERS/SOT → CORNERS; G4 COMBO → COMBO

## EMS snapshot contracts (read-only, logic unchanged)

### Decision Maker

Source: `processBatchDecisions` → `MatchDecisionRow.markets[]` (`ScoredDecisionMarket`).

Snapshot fields per candidate:

- `marketKey`, `label`, `prediction`, `line?`
- `totalScore` → EMS score
- `confidence` → EMS confidence (0–100)
- `contributingPages[]`, `category`, `priorAlign?`

Top-3 order preserved as `existing_rank` 1–3.

### Weekend Picks

Source: `scoreFixtureBestMarket` → `BestMarketPick` + `WeekendOpportunityTrace`.

Snapshot fields:

- `family`, `selectionKey`, `pRaw`, `pCalibrated`, `nEffective`
- `secondBestPCalibrated`, `marketMargin`, `marginOk`
- EMS score derived as `100 * pCalibrated` for best; runner-up at rank 2

## Probability paths excluded from MSAM

- `computeMasterProbability` / stat-probability master path — signal blend, not canonical grid
- Any `weightedEstimate` applied directly to market **probabilities** (forbidden)
- Odds, implied probability, EV, stake, bankroll logic
- Naïve combo multiplication `P(A)*P(B)` when events are dependent

## Canonical probability source (MSAM only)

1. `canonicalFixtureEstimate` / `estimateBatchCanonicalAsync`
2. `buildScoreMatrix` + `computeGoalDistribution`
3. `resolveCfeLegProbability` for each catalog proposition

λ-level 60/40 via `weightedEstimate` in `prediction-weights.ts` — feature level only.

## Data lineage

| Field | Source |
|---|---|
| fixture_id | `LogMatch.apiFixtureId` or Match Centre `apiFixtureId` |
| prediction_cutoff_at | kickoff or explicit cutoff; no post-match data |
| API history | Postgres `core_fixture`, API ingestion |
| System history | KV `PredictionBatch` settled rows, manual batches |
| provenance | CFE `provenance`: `api_pct`, `manual_pct`, `ess`, `matches_used`, `sourceBreakdown` |
| calibration bootstrap | `fitSlipCalibrator` → batches + `bayesianCalibrationLog` |

## Integrity requirements

Runtime gate (see `integrity-gate.ts`):

- `sum(score_grid) ≈ 1`
- 1X2, O/U pairs, BTTS, double-chance identities
- Tail mass below cap tolerance

On failure: suppress affected candidates; `PROBABILITY_INTEGRITY_FAILURE`.
