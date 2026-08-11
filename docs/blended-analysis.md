# Blended analysis (60% API / 40% system)

Additive layer on top of the existing analysis stack. **Default off.** Legacy calculations stay the source of truth for displayed markets unless the flag is on **and** blend status is `complete`.

## Discovery map (primary surfaces)

| Surface | Entrypoint | Data |
|---|---|---|
| Half Goals | `canonical-fixture-estimate` via `use-hsh-predictions` | hist rates + KV batches |
| Total Goals | CFE `markets.totalGoals` | hist half-params + batches |
| DIEH | CFE `markets.dieh` | hist κ/shares + batches |
| Ladder | CFE P(2H>1H) | same |
| Corners | `corners-model` + CFE corners markets | seed + live + CFE |
| Analysis / Stats | `analysis.ts` | settled KV batches |
| Decision Maker | CFE caches; page weights exempt | registry |

Existing λ blend: [`lib/prediction-log/prediction-weights.ts`](../lib/prediction-log/prediction-weights.ts) (`weightedEstimate`).

## Provenance mapping (no silent guesses)

| Class | Rule |
|---|---|
| `api_historical` | `hist_*` / hist-derived intensities |
| `manual_batch` | KV `batchKind=manual` (or unset), no bulk meta |
| `system_historical` | Seed baselines, `livescore-bulk` batches |
| `ai_learner` | Learner / capacity aggregates |
| `unknown` | Recommended batches, missing signals — **excluded** from blend |

`resultSource: "api-football"` on a match is settlement fill only, not corpus class.

## Feature flags

| Env | Default | Meaning |
|---|---|---|
| `ANALYSIS_BLENDED_MODE_ENABLED` | `false` | Master switch (server) |
| `NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED` | unset | Client CFE + UI notice |
| `ANALYSIS_BLENDED_MIN_API_RECORDS` | `8` | Min API-side samples |
| `ANALYSIS_BLENDED_MIN_SYSTEM_RECORDS` | `5` | Min system-side samples |
| `ANALYSIS_BLENDED_FALLBACK_MODE` | `legacy` | Or `normalize_effective_weights` |
| `ANALYSIS_BLENDED_PAGES` | (all) | Optional allowlist |

**Rollback:** set both flags to `false` / unset. Pages immediately use exact legacy path (no `analysisBlend` field).

## System group (40%)

Manual batches + system historical + AI learner are pooled with existing aggregation (sample-weighted means / seed+live blend). **No invented sub-weights** inside the 40%.

## UI

`BlendedAnalysisNotice` shows the 60/40 explanation, record counts, date coverage, confidence, and calm warnings. Mounted on Half Goals, Total Goals, DIEH, Ladder, Corners, Analysis.

## Audit

Optional rows in `core_analysis_run` via `writeAnalysisRunAudit`. Additive table only.

## Comparison report

```bash
npx tsx scripts/blended-analysis-compare.ts
```

Writes `docs/reports/blended-analysis-compare-<date>.md`. Do not enable globally until reviewed.

## Unit tests

```bash
npx tsx lib/analysis/provenance.test.ts
npx tsx lib/analysis/blend-math.test.ts
npx tsx lib/analysis/source-groups.test.ts
npx tsx lib/analysis/blended-analysis-service.test.ts
```
