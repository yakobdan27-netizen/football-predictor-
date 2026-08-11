# Blended analysis comparison (2026-08-11)

Synthetic KPI cases (λ-like). Review before setting `ANALYSIS_BLENDED_MODE_ENABLED=true`.

| Case | Legacy weightedEstimate | API-only | System-only | Blended value | Status | Eff API | Eff Sys | Warnings |
|---|---|---|---|---|---|---|---|---|
| both sides | 1.28 (blended) | 1.4 | 1.1 | 1.28 | complete | 0.6 | 0.4 | — |
| API only | 1.4 (api_only) | 1.4 | — | — | unavailable | 0.6 | 0.4 | System group below minimum quality — falling back to legacy result |
| system only | 1.1 (manual_ai_only) | — | 1.1 | — | unavailable | 0.6 | 0.4 | API group below minimum quality — falling back to legacy result |
| empty | — (null) | — | — | — | unavailable | 0.6 | 0.4 | Both API and system groups lack sufficient valid data |
| below min system | 1.28 (blended) | 1.4 | 1.1 | — | unavailable | 0.6 | 0.4 | System group below minimum quality — falling back to legacy result |
| duplicate-ish equal | 2 (blended) | 2 | 2 | 2 | complete | 0.6 | 0.4 | — |

## Config

```json
{
  "apiWeight": 0.6,
  "systemWeight": 0.4,
  "minApiRecords": 8,
  "minSystemRecords": 5,
  "maxAgeDays": 0,
  "fallbackMode": "legacy",
  "calculationVersion": "blended-analysis-v1"
}
```

## Notes

- Flag was forced on for this script only; production default remains off.
- Missing side is never treated as zero under `fallbackMode=legacy`.
