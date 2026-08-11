# Core database runbook

Additive `core_*` layer beside existing Postgres + KV stores. **Do not** DROP/RENAME legacy tables. Pages keep reading legacy until shadow compare passes.

## Phase 0 — Freeze (ops)

1. Create a Neon branch (or snapshot) and confirm restore works.
2. Capture row counts for all PG tables + KV `batchIndex` length.
3. Record git SHA / deployment version at freeze.

## Inventory

```bash
npx tsx scripts/db-dependency-inventory.ts
```

Emits `docs/database_dependency_inventory.md`. Protected objects listed there must not change.

## Ensure schema

App boot calls `ensureSchema()` (`CREATE TABLE IF NOT EXISTS` only). Locally:

```bash
npx tsx -e "import('./lib/db/init').then(m => m.ensureSchema()).then(() => console.log('ok'))"
```

## Seed competitions + backfill

Dry-run first (no writes to core facts beyond schema ensure):

```bash
npx tsx scripts/core-backfill.ts --dry-run
```

Limited write:

```bash
npx tsx scripts/core-backfill.ts --limit 500
```

Full backfill:

```bash
npx tsx scripts/core-backfill.ts
```

Flags:

- `--dry-run` — count/plan only where possible; still requires DB for reads
- `--limit N` — cap fixtures
- `--skip-kv` — skip pending Prediction Log → `core_result_trace` bridge

## Reconcile

```bash
npx tsx scripts/core-reconcile.ts
```

Writes `docs/reports/core-reconcile-<date>.md`. Exit codes:

- `0` — OK
- `1` — hard integrity failure (dupes / orphans / self-fixtures / unexplained gap)
- `2` — soft: hist present but no maps yet

## Shadow compare

```bash
npx tsx scripts/core-shadow-compare.ts --sample 50
```

Env:

| Flag | Default | Meaning |
|---|---|---|
| `CORE_RESULT_TRACE_WRITE` | on (`1`) | Write provenance to `core_result_trace` |
| `CORE_SHADOW_FIXTURE_READ` | off (`0`) | Log hist vs compat diffs in helpers; **pages still return legacy** |

## Result-trace bridge

After existing name-pair fill (`tracePendingMatchResults`), bridge upserts `core_result_trace`. Settlement remains `fillMatchFromFixture` → `saveBatch` (KV). Ambiguous / reversed / missing never auto-picked by date alone.

## Integrity cron

Route: `GET/POST /api/cron/core-integrity`  
**Not scheduled** in `vercel.json` until validated. Authorize with `Authorization: Bearer $CRON_SECRET` when set.

## Import failure

1. Leave legacy hist_* untouched.
2. Re-run `core-backfill.ts` (idempotent; skips `manual_verified=1`).
3. Re-run `core-reconcile.ts`.

## Alias review

Unapproved aliases: `core_team_alias.approved = 0`. Approve only after human review:

```sql
UPDATE core_team_alias SET approved = 1 WHERE id = :id;
```

Fuzzy-only imports must stay `approved = 0`.

## Rollback

1. Stop writing: `CORE_RESULT_TRACE_WRITE=0`, `CORE_SHADOW_FIXTURE_READ=0`.
2. Do **not** drop legacy tables.
3. Optional: truncate only additive tables (`core_*`, `audit_data_change_log`) on a branch first; production truncate only with explicit ops approval.
4. Pages already read legacy — no read-path rollback required for this delivery.
