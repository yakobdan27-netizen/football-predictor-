# Football Predictor

This application is **fully manual**. No football APIs or external data sources are used.

All intelligence comes from your own data:

- **Prediction Log** — enter batches, predictions, odds, and results (Vercel KV)
- **AI Learner** — learned patterns, club capacities/histories, and support notes from your history
- **Recommendation** — generate risk-filtered recommended batches with dynamic batch risk scoring
- **Analysis** — performance breakdown by odds, market, batch, and club
- **Backtest** — Dixon-Coles engine evaluation on CSV-uploaded or demo-seeded match history

## Setup

1. Copy `.env.example` to `.env.local` and set `DATABASE_URL`.
2. `npm install`
3. `npm run dev`

Predictions are entered manually. Prediction Log batches and club histories are stored in **Vercel KV** (Upstash Redis) when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set; locally, an in-memory fallback is used. UI preferences (recommendation settings, lucky numbers) remain in the browser. Backtest needs the database with uploaded or seeded match data.

**Optional results sync:** set `API_FOOTBALL_KEY` (api-sports.io) to fetch finished match results into saved Prediction Log batches via **Sync results from API** on the Saved Batches tab. Predictions and odds remain manual; only actual results are filled from the API.

## Deploy on Vercel (frontend + API + Neon Postgres)

The project is a Next.js app: UI and `/api/*` routes deploy as Vercel serverless functions. The database is **Neon Postgres** (via Vercel Storage integration).

**Production URL:** [https://football-predictor-nine-eta.vercel.app](https://football-predictor-nine-eta.vercel.app)

### One-time setup

1. Link the project: `vercel link` (already linked as `football-predictor`).
2. Add Neon from the [Vercel Marketplace](https://vercel.com/marketplace) — this sets `DATABASE_URL` automatically.
3. Add Upstash Redis / KV — sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` (required for Prediction Log persistence).
4. Deploy: `vercel deploy --prod`

**Git CI (auto-deploy on push):** create a GitHub repo and connect it:

```powershell
# After: gh auth login
powershell -ExecutionPolicy Bypass -File scripts/connect-github.ps1
```

Or in the [Vercel Dashboard](https://vercel.com/jacobs21983/football-predictor/settings/git) → **Git** → connect the repository.

Tables are created automatically on first API request (`ensureSchema` in `lib/db/init.ts`). Seed demo data from the Dashboard **Home** page or `POST /api/seed`.

### Environment variables (production)

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Neon pooled connection string (auto-set by Vercel Neon integration) |
| `KV_REST_API_URL` | For production KV | Auto-set by Vercel KV / Upstash Redis integration |
| `KV_REST_API_TOKEN` | For production KV | Auto-set by Vercel KV / Upstash Redis integration |
| `API_FOOTBALL_KEY` | Optional | api-sports.io key for Prediction Log results sync (server-only) |

## Data entry

| Feature | How data enters the system |
|---------|---------------------------|
| Training matches | Upload football-data.co.uk CSV or load demo seed on Dashboard |
| Prediction Log | Manual batch entry; optional API results sync; saves sync to KV club histories and update AI Learner / Analysis |
| Lucky numbers | Optional on Recommendation page (stored locally) |

See [docs/OPERATING.md](docs/OPERATING.md) for the full workflow.
