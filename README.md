# Football Predictor

This application is primarily **manual**. Predictions and odds are entered by you.

Optional **API-Football** (api-sports.io, direct — not RapidAPI) auto-fills finished FT/HT scores and corners on the Prediction Log Result Filling tab. The key stays server-side only.

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

**Optional results Auto-Fill:** set `API_FOOTBALL_KEY` (api-sports.io direct key) and optionally `API_FOOTBALL_BASE_URL` (default `https://v3.football.api-sports.io`). On Prediction Log → Saved Batches, **Auto-Fill Results** fetches finished fixtures (FT/HT/corners) via the server. Verify with `npx tsx scripts/verify-api-football.ts` or `GET /api/football-status`. Predictions and odds remain manual; only empty result cells are filled (manual values are kept unless you tap Replace).

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
| `API_FOOTBALL_KEY` | Optional | api-sports.io direct key for Result Filling Auto-Fill (server-only; header `x-apisports-key`) |
| `API_FOOTBALL_BASE_URL` | Optional | Default `https://v3.football.api-sports.io` |
| `TELEGRAM_BOT_TOKEN` | Optional | BotFather token for external Telegram access |
| `TELEGRAM_WEBHOOK_SECRET` | Optional | Secret token verified on `POST /api/telegram/webhook` |
| `INTERNAL_API_KEY` | Optional | Shared secret for `/api/internal/*` (header `x-internal-api-key`) |
| `CRON_SECRET` | Optional | Bearer token for Vercel cron routes (`/api/cron/*`, bulk history) |

### Telegram bot (external users)

External users access **Create Batch** and **Get Decision** only via Telegram — never analysis/admin pages.

Telegram batches save to the same KV as web batches (`source: "telegram"`). They are **system training data**: an admin fills results on Prediction Log → Saved Batches (Auto-Fill All includes Telegram, or enter manually). After scoring, the **global AI Learner** (KV `learnerStats`) updates and feeds both **Recommendation** and Telegram **Get Decision**. Optional catch-up cron: `GET/POST /api/cron/fill-telegram-results` (daily 08:00 UTC; protect with `CRON_SECRET`).

1. Create a bot with [@BotFather](https://t.me/BotFather) and set `TELEGRAM_BOT_TOKEN` in `.env.local` + Vercel.
2. Set a random `TELEGRAM_WEBHOOK_SECRET` and `INTERNAL_API_KEY`.
3. Deploy, then register the webhook: `npx tsx scripts/set-telegram-webhook.ts`
4. Open [t.me/BettingVarBot](https://t.me/BettingVarBot) → `/start` → Create Batch (name → date → tap league → HOME → AWAY → market → pick → odds, up to 20 matches) → Get Decision (3 markets per match, advisory only).

Webhook: `POST /api/telegram/webhook`  
Internal APIs (bot/services): `/api/internal/users/register`, `/api/internal/batches`, `/api/internal/batches/:id/decision` (ownership enforced).

## Data entry

| Feature | How data enters the system |
|---------|---------------------------|
| Training matches | Upload football-data.co.uk CSV or load demo seed on Dashboard |
| Prediction Log | Manual batch entry; Auto-Fill Results from API-Football (empty cells); optional Livescore fallback; saves sync to KV club histories and update AI Learner / Analysis (includes Telegram batches after admin fill) |
| Lucky numbers | Optional on Recommendation page (stored locally) |

See [docs/OPERATING.md](docs/OPERATING.md) for the full workflow.
