# Database dependency inventory

Generated: 2026-08-11T13:22:42.852Z

Additive `core_*` / `analytics_*` / `audit_*` work must not alter protected objects below. Existing stores remain authoritative until dual-read comparison passes.

## Protected objects (hard fail in review if altered)

| Store | Objects |
|---|---|
| PG | hist_*, team_half_stats, hist_league_half_params, live_*, match_stats, bet_*, ext_*, slip_*, matches |
| KV | batch:*, batchIndex, club:*, manual-results, learner/priors keys |
| Code | Analysis apps, Decision Maker, Prediction Log, result sync/trace, bets settle |

## Postgres tables (`lib/db/schema.ts`)

| Object | Protected | Risk | Read paths | Write paths | Dependent pages | Code refs (files) | Sample paths |
|---|---|---|---|---|---|---|---|
| `audit_data_change_log` | no | unknown | see code refs | see code refs | see code refs | 4 | docs/database-core-erd.md, docs/database-core-runbook.md, lib/db/init.ts, lib/db/schema.ts |
| `bet_events` | YES | critical | bets feed | bets load | Bet Tracker | 3 | app/api/bets/load/route.ts, lib/db/init.ts, lib/db/schema.ts |
| `bet_markets` | YES | critical | bets | bets load | Bet Tracker | 4 | lib/bets/odds-fetch.ts, lib/db/init.ts, lib/db/schema.ts, lib/football-api/endpoint-map.ts |
| `bet_selections` | YES | critical | bets settle | bets slips/settle | Bet Tracker | 2 | lib/db/init.ts, lib/db/schema.ts |
| `bet_slips` | YES | critical | bets slips | bets slips/settle | Bet Tracker | 3 | lib/db/init.ts, lib/db/schema.ts, lib/ext-bets/store.ts |
| `core_competition` | no | unknown | see code refs | see code refs | see code refs | 5 | docs/database-core-erd.md, lib/core/backfill-from-hist.ts, lib/core/seed-competitions.ts, lib/db/init.ts, lib/db/schema.ts |
| `core_coverage_audit` | no | unknown | see code refs | see code refs | see code refs | 4 | docs/database-core-erd.md, lib/core/backfill-from-hist.ts, lib/db/init.ts, lib/db/schema.ts |
| `core_fixture` | no | unknown | see code refs | see code refs | see code refs | 8 | app/api/cron/core-integrity/route.ts, docs/database-core-erd.md, lib/core/backfill-from-hist.ts, lib/core/shadow-read.ts, lib/db/init.ts, lib/db/schema.ts |
| `core_fixture_statistic` | no | unknown | see code refs | see code refs | see code refs | 6 | app/api/cron/core-integrity/route.ts, docs/database-core-erd.md, lib/core/backfill-from-hist.ts, lib/db/init.ts, lib/db/schema.ts, scripts/core-reconcile.ts |
| `core_legacy_record_map` | no | unknown | see code refs | see code refs | see code refs | 9 | app/api/cron/core-integrity/route.ts, docs/database-core-erd.md, lib/core/backfill-from-hist.ts, lib/core/mapping.test.ts, lib/core/shadow-read.ts, lib/db/init.ts |
| `core_market_probability` | no | unknown | see code refs | see code refs | see code refs | 3 | docs/database-core-erd.md, lib/db/init.ts, lib/db/schema.ts |
| `core_prediction_run` | no | unknown | see code refs | see code refs | see code refs | 3 | docs/database-core-erd.md, lib/db/init.ts, lib/db/schema.ts |
| `core_provider_ingestion` | no | unknown | see code refs | see code refs | see code refs | 2 | lib/db/init.ts, lib/db/schema.ts |
| `core_result_trace` | no | unknown | see code refs | see code refs | see code refs | 9 | app/api/cron/core-integrity/route.ts, docs/database-core-erd.md, docs/database-core-runbook.md, lib/core/backfill-from-hist.ts, lib/core/feature-flags.ts, lib/core/result-trace-bridge.ts |
| `core_season` | no | unknown | see code refs | see code refs | see code refs | 5 | docs/database-core-erd.md, lib/core/backfill-from-hist.ts, lib/core/seed-competitions.ts, lib/db/init.ts, lib/db/schema.ts |
| `core_team` | no | unknown | see code refs | see code refs | see code refs | 6 | docs/database-core-erd.md, docs/database-core-runbook.md, lib/core/alias.ts, lib/core/backfill-from-hist.ts, lib/db/init.ts, lib/db/schema.ts |
| `core_team_alias` | no | unknown | see code refs | see code refs | see code refs | 6 | docs/database-core-erd.md, docs/database-core-runbook.md, lib/core/alias.ts, lib/core/backfill-from-hist.ts, lib/db/init.ts, lib/db/schema.ts |
| `ext_selections` | YES | high | external coupons | ext coupon APIs | external bet UI | 2 | lib/db/init.ts, lib/db/schema.ts |
| `ext_slips` | YES | high | external coupons | ext coupon APIs | external bet UI | 3 | lib/db/init.ts, lib/db/schema.ts, lib/ext-bets/settle.ts |
| `ext_users` | YES | high | external coupons | ext coupon APIs | external bet UI | 3 | lib/db/init.ts, lib/db/schema.ts, lib/ext-bets/phone.ts |
| `hist_fixtures` | YES | critical | analysis, DIEH, half goals, coverage | lib/hist only | Goals & Survival, Research, Decision Maker inputs | 14 | app/api/cron/core-integrity/route.ts, app/api/two-h-heavy/profiles/route.ts, AUDIT_REPORT.md, lib/core/backfill-from-hist.ts, lib/core/mapping.test.ts, lib/core/shadow-read.ts |
| `hist_goals` | YES | critical | half/goal timing models | lib/hist | analysis apps | 3 | lib/db/init.ts, lib/db/schema.ts, lib/hist/team-half-intensities.ts |
| `hist_jobs` | YES | medium | hist backfill status | hist cron/drain | system-info | 4 | lib/db/init.ts, lib/db/schema.ts, scripts/accept-hist-six-comps.ts, scripts/ensure-hist-11-window.ts |
| `hist_league_half_params` | YES | critical | DIEH / half share | lib/hist fit-half-params | DIEH, Goals & Survival | 3 | lib/db/init.ts, lib/db/schema.ts, scripts/fit-half-params.ts |
| `hist_lineups` | YES | medium | optional hist completeness | lib/hist | coverage audit | 2 | lib/db/init.ts, lib/db/schema.ts |
| `hist_meta` | YES | critical | model params / betas / priors | lib/hist recompute | analysis apps | 7 | AUDIT_REPORT.md, lib/db/init.ts, lib/db/schema.ts, lib/hist/league-priors.ts, lib/hist/model-params.ts, scripts/accept-hist-wire.ts |
| `hist_stats` | YES | critical | corners / shots models | lib/hist | analysis apps | 6 | AUDIT_REPORT.md, lib/core/backfill-from-hist.ts, lib/db/init.ts, lib/db/schema.ts, lib/slip-builder/hist-cooccurrence.ts, scripts/core-shadow-compare.ts |
| `hist_teams` | YES | high | hist team directory | lib/hist | Teams & Leagues | 3 | lib/core/backfill-from-hist.ts, lib/db/init.ts, lib/db/schema.ts |
| `live_events` | YES | high | live detail | lib/live | live fixture detail | 4 | lib/bets/settle.ts, lib/db/init.ts, lib/db/schema.ts, lib/football-api/endpoint-map.ts |
| `live_fixtures` | YES | critical | live + settle + DM open-in | lib/live only | Match Centre, bets settle | 9 | app/api/live/refresh/match-stats/route.ts, lib/bets/odds-fetch.ts, lib/db/init.ts, lib/db/schema.ts, lib/football-api/endpoint-map.ts, lib/live/refresh-types.ts |
| `live_leagues` | YES | high | live fixtures feed | lib/live sync | Match Centre live | 2 | lib/db/init.ts, lib/db/schema.ts |
| `live_sync_meta` | YES | medium | system-info / sync status | live sync jobs | ops panels | 2 | lib/db/init.ts, lib/db/schema.ts |
| `match_stats` | YES | high | stats backfill consumers | stats API backfill | corners / stats tools | 16 | app/api/live/refresh/match-stats/route.ts, components/live/live-refresh-app.tsx, lib/core/backfill-from-hist.ts, lib/db/init.ts, lib/db/schema.ts, lib/football-api/endpoint-map.ts |
| `matches` | YES | medium | CSV import / legacy match lists | seed/upload routes | legacy match tools | 237 | app/api/admin/fixture-estimate/route.ts, app/api/backtest/route.ts, app/api/backtest-reco/route.ts, app/api/besoccer-status/route.ts, app/api/cron/fill-telegram-results/route.ts, app/api/hist/combo-grids/route.ts |
| `slip_batch_legs` | YES | high | slip builder history | slip builder commit | Combo Centre / Slip Builder | 2 | lib/db/init.ts, lib/db/schema.ts |
| `slip_batches` | YES | high | slip builder history | slip builder commit | Combo Centre / Slip Builder | 2 | lib/db/init.ts, lib/db/schema.ts |
| `stats_backfill_meta` | no | low | backfill status | stats cron | ops | 2 | lib/db/init.ts, lib/db/schema.ts |
| `team_half_stats` | YES | critical | 2H-heavy / half intensity | lib/hist | analysis + DM | 6 | app/api/hist/recompute-betas/route.ts, app/api/two-h-heavy/profiles/route.ts, lib/db/init.ts, lib/db/schema.ts, lib/hist/persist-team-half-stats.ts, scripts/recompute-hist-model-inputs.ts |
| `team_ratings` | no | high | prediction engines | hist recompute | analysis apps | 4 | AUDIT_REPORT.md, lib/db/init.ts, lib/db/schema.ts, lib/hist/persist-team-ratings.ts |
| `team_season_stats` | no | medium | team quality / ratings helpers | stats aggregate jobs | Teams & Leagues | 7 | lib/db/init.ts, lib/db/schema.ts, lib/live/team-season-stats-recompute.ts, lib/prediction-log/corners-baselines.ts, lib/prediction-log/corners-model.ts, lib/prediction-log/per-team-lines.test.ts |

## KV stores (Prediction Log / clubs)

| Object | Protected | Risk | Read paths | Write paths | Dependent pages |
|---|---|---|---|---|---|
| `batch:*` / `batchIndex` | YES | critical | `lib/prediction-log/club-store.ts` | batch APIs, sync-results, telegram | Prediction Log, Decision Maker batch pickers |
| `club:*` | YES | high | club-store / club histories | club history writer | Clubs pages |
| manual-results / learner / priors | YES | high | prediction-log stores | recompute on settle | Prediction Log, learner panels |
| team id map (KV) | YES | high | `lib/football-api/team-id-map.ts` | resolve on API lookup | result trace |

## Additive layer (new — not protected legacy)

New tables use `core_*`, `analytics_*`, `audit_*` prefixes in `public`. They are empty or backfilled copies; pages must keep reading legacy until shadow compare passes.

## Freeze checklist (ops)

1. Neon backup + restore test on a branch DB.
2. Capture row counts for all PG tables + KV `batchIndex` length.
3. Record app version / git SHA at freeze.
