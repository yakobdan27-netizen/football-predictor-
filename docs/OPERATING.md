# Football Prediction System — Operating Guide

> **This application is fully manual.** No football APIs or external data sources are used. All match data, predictions, results, and odds come from user input (CSV upload, demo seed, or manual entry in the Prediction Log).

This guide maps the seven-stage prediction workflow to this app. The engine produces **probabilities**, not certainties. A realistic ceiling for match-outcome accuracy is roughly **50–55%**.

## Four-page prediction workflow

```
Prediction Log → (results saved) → AI Learner + Analysis → Recommendation → Prediction Log
```

| Page | Route | Purpose |
|------|-------|---------|
| **Prediction Log** | `/prediction-log` | Enter predictions, odds, and actual results |
| **AI Learner** | `/ai-learner` | View learned patterns, club capacities/histories, support notes; export club JSON |
| **Recommendation** | `/recommendation` | Generate risk-filtered recommended batch with live batch risk score |
| **Analysis** | `/analysis` | Win rate, odds bands, markets, batches, clubs, systematic judgement |
| **Risk & Evaluation** | `/risk` | Bankroll health, yield/CLV, drawdown, Monte Carlo reality check |

All four pages share the same KV-backed data store (batches + per-club append-only histories). Saving results on the Log updates club capacities, the Learner, and Analysis automatically.

## Club-centric storage (Vercel KV)

**Write path**

1. Save a batch on **Prediction Log** → `POST /api/batches`
2. Server assigns `homeClubId` / `awayClubId`, appends pending history entries per club and market type
3. Enter actual results (including optional team stats: cards, fouls, possession) → batch update resolves hit/miss, recomputes `ClubCapacity`, refreshes head-to-head cache

**Read path**

- **Recommendation** loads both clubs per fixture and runs head-to-head comparison for confidence notes
- **AI Learner** and **Analysis** browse club index → per-type histories and capacity summary
- **Export:** AI Learner → *Download all club data (JSON)* → `GET /api/clubs/export`

**Manual edits:** PATCH `/api/clubs/{clubId}` creates a new history entry and soft-supersedes the prior one (`editedAt` timestamp).

**Migration:** On first load, existing localStorage batches are POSTed to `/api/migrate` once, then local batch keys are cleared.

UI-only keys (recommendation settings, lucky numbers, learner toggle) stay in the browser.

## Workflow stages

```
COLLECT → CLEAN → ENGINEER → TRAIN → PREDICT → EVALUATE → REFINE
```

| Stage | What to do in this app |
|-------|------------------------|
| **Collect** | Upload a football-data.co.uk CSV, load demo data, or enter fixtures in the Prediction Log |
| **Clean** | Automatic on CSV upload: team-name standardization, range checks, deduplication |
| **Engineer** | Set time decay (ξ) on Backtest — recent matches count more |
| **Train** | Model fits on demand when you run a backtest |
| **Predict** | Log picks on **Prediction Log**; generate reco on **Recommendation** |
| **Evaluate** | Review **Analysis** and run **Backtest** for model calibration |
| **Refine** | Check **AI Learner** patterns; adjust strategy; re-run monthly |

### Odds blending and calibration (opt-in)

Available on **Backtest** when you enable them:

1. Upload a football-data.co.uk CSV that includes **B365H**, **B365D**, **B365A** (and optionally **B365>2.5** / **B365<2.5**).
2. Enable **Blend Bet365 odds** and set **blend alpha** (1 = model only, 0 = market only).
3. Enable **Apply calibration** to adjust probabilities toward observed frequencies.
4. Compare **model-only** vs **enhanced** Brier and ECE on the holdout fold.

## Weekly routine

| When | Action |
|------|--------|
| After each matchweek | Enter results in Prediction Log (or upload CSV for Backtest data) |
| Before fixtures | Log predictions; run Recommendation for next batch |
| After results | Check Analysis and AI Learner for updated patterns |
| Monthly | Run backtest; review calibration (ECE) and Brier scores |

## Honest expectations

- Compare probabilities across markets (e.g. strong favourite + high shot expectation reinforces the signal).
- Bookmaker lines are efficient; the goal is a **well-calibrated analytical tool**, not guaranteed profit.
- Recommendation caps at 4 matches and filters by combined-odds risk — tune settings on the Recommendation page.

## What success looks like

Past performance does not guarantee future results. This app is **decision support**, not a profit guarantee.

| Reality | Implication |
|---------|-------------|
| **Variance** | Short samples swing wildly; treat win rate / ROI as noisy until **300+** settled stake bets. |
| **Vig** | Bookmaker margin means a fair model can still lose money without a true edge over the close. |
| **CLV over raw P&L** | Beating closing odds (positive CLV) is a better long-term skill signal than a hot week of profit. |
| **Risk of ruin** | Cap stakes at **1–2%** of bankroll; respect stop-loss pauses (consecutive losses + rolling drawdown). |
| **Survival** | Success = calibrated picks, bankroll still standing, and improving process — not a fixed win rate. |

Track evaluation on **Risk & Evaluation** (`/risk`): yield, drawdown, optional closing-odds CLV, and a Monte Carlo reality check.
