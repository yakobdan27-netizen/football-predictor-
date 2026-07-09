"""
Football Prediction Engine
===========================
Predicts: Win/Draw/Loss, Over/Under goals, Total Shots,
          Shots on Target, and Offsides for a given fixture.

Approach
--------
- Goals  -> Dixon-Coles model (Poisson with low-score correction)
- Shots / Shots on Target / Offsides -> independent Poisson strength models
- Time-decay weighting -> recent matches count more in MLE fitting
- Backtesting -> chronological train/test split with calibration metrics

Each model learns per-team ATTACK and DEFENCE strengths plus a global
HOME-ADVANTAGE term, then turns them into expected counts (lambdas) for a
fixture and converts those into full probability distributions.

Input data format (CSV)
-----------------------
Required columns (one row per played match):
    HomeTeam, AwayTeam, FTHG, FTAG          (full-time home/away goals)
Optional columns (enable the extra markets if present):
    Date        -> match date (DD/MM/YY or DD/MM/YYYY); enables time-decay
    HS, AS      -> home/away total shots
    HST, AST    -> home/away shots on target
    HO, AO      -> home/away offsides
This matches the popular football-data.co.uk CSV schema.

Usage
-----
    python football_predictor.py            # runs the built-in demo
    -- or in your own code --
    engine = FootballPredictor(decay_xi=0.002)
    engine.fit("matches.csv")
    print(engine.predict("Arsenal", "Chelsea"))
    print(engine.backtest("matches.csv"))
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Dict, Optional

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import poisson


# --------------------------------------------------------------------------- #
#  Data preparation helpers                                                   #
# --------------------------------------------------------------------------- #
def prepare_match_data(df: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray]:
    """
    Sort matches oldest-first and compute exponential time-decay weights.

    Returns (sorted_df, weights). Weights are normalized to mean 1.0.
    """
    out = df.copy()
    if "Date" in out.columns:
        out["_sort_date"] = pd.to_datetime(out["Date"], dayfirst=True, errors="coerce")
        if out["_sort_date"].isna().any():
            warnings.warn(
                "Some Date values could not be parsed; those rows sort last.",
                stacklevel=2,
            )
        out = out.sort_values("_sort_date", kind="mergesort").reset_index(drop=True)
        out = out.drop(columns=["_sort_date"])
    else:
        warnings.warn(
            "No Date column found; using row order as proxy for recency.",
            stacklevel=2,
        )

    return out


def compute_time_weights(
    df: pd.DataFrame,
    decay_xi: float,
) -> np.ndarray:
    """Exponential decay: w_i = exp(-decay_xi * age_days), normalized to mean 1."""
    n = len(df)
    if decay_xi <= 0 or n == 0:
        return np.ones(n, dtype=float)

    if "Date" in df.columns:
        dates = pd.to_datetime(df["Date"], dayfirst=True, errors="coerce")
        max_date = dates.max()
        age_days = (max_date - dates).dt.days.fillna(0).to_numpy(dtype=float)
    else:
        age_days = np.arange(n - 1, -1, -1, dtype=float)

    weights = np.exp(-decay_xi * age_days)
    weights /= weights.mean()
    return weights


# --------------------------------------------------------------------------- #
#  Generic Poisson strength model (used for shots, shots on target, offsides) #
# --------------------------------------------------------------------------- #
class PoissonStrengthModel:
    """
    Models a count statistic with team attack/defence strengths + home edge.

        log(lambda_home) = home_adv + attack[home] - defence[away]
        log(lambda_away) =           attack[away] - defence[home]
    """

    def __init__(self, name: str = "stat"):
        self.name = name
        self.teams: list[str] = []
        self.attack: Dict[str, float] = {}
        self.defence: Dict[str, float] = {}
        self.home_adv: float = 0.0
        self.base: float = 0.0

    def fit(
        self,
        df: pd.DataFrame,
        home_col: str,
        away_col: str,
        weights: Optional[np.ndarray] = None,
    ) -> "PoissonStrengthModel":
        self.teams = sorted(set(df["HomeTeam"]) | set(df["AwayTeam"]))
        idx = {t: i for i, t in enumerate(self.teams)}
        n = len(self.teams)

        h = df["HomeTeam"].map(idx).to_numpy()
        a = df["AwayTeam"].map(idx).to_numpy()
        hc = df[home_col].to_numpy(dtype=float)
        ac = df[away_col].to_numpy(dtype=float)
        w = np.ones(len(df)) if weights is None else np.asarray(weights, dtype=float)

        def unpack(p):
            base, home_adv = p[0], p[1]
            atk = p[2 : 2 + n]
            dfc = p[2 + n : 2 + 2 * n]
            return base, home_adv, atk, dfc

        def neg_log_like(p):
            base, home_adv, atk, dfc = unpack(p)
            atk = atk - atk.mean()
            dfc = dfc - dfc.mean()
            lam_h = np.exp(base + home_adv + atk[h] - dfc[a])
            lam_a = np.exp(base + atk[a] - dfc[h])
            ll_h = poisson.logpmf(hc, lam_h)
            ll_a = poisson.logpmf(ac, lam_a)
            return -(w * (ll_h + ll_a)).sum()

        x0 = np.concatenate(
            [[np.log(hc.mean() + 1e-6), 0.1], np.zeros(n), np.zeros(n)]
        )
        res = minimize(neg_log_like, x0, method="L-BFGS-B")

        base, home_adv, atk, dfc = unpack(res.x)
        atk = atk - atk.mean()
        dfc = dfc - dfc.mean()
        self.base, self.home_adv = base, home_adv
        self.attack = dict(zip(self.teams, atk))
        self.defence = dict(zip(self.teams, dfc))
        return self

    def expected(self, home: str, away: str) -> tuple[float, float]:
        lam_h = np.exp(
            self.base + self.home_adv + self.attack[home] - self.defence[away]
        )
        lam_a = np.exp(self.base + self.attack[away] - self.defence[home])
        return lam_h, lam_a


# --------------------------------------------------------------------------- #
#  Dixon-Coles goal model (W/D/L and Over/Under)                              #
# --------------------------------------------------------------------------- #
class DixonColesModel:
    """Poisson goals model with the Dixon-Coles low-score dependency term."""

    def __init__(self):
        self.teams: list[str] = []
        self.attack: Dict[str, float] = {}
        self.defence: Dict[str, float] = {}
        self.home_adv: float = 0.0
        self.rho: float = 0.0

    @staticmethod
    def _tau(hg, ag, lam, mu, rho):
        out = np.ones_like(lam, dtype=float)
        out = np.where((hg == 0) & (ag == 0), 1 - lam * mu * rho, out)
        out = np.where((hg == 0) & (ag == 1), 1 + lam * rho, out)
        out = np.where((hg == 1) & (ag == 0), 1 + mu * rho, out)
        out = np.where((hg == 1) & (ag == 1), 1 - rho, out)
        return np.clip(out, 1e-9, None)

    def fit(
        self,
        df: pd.DataFrame,
        weights: Optional[np.ndarray] = None,
    ) -> "DixonColesModel":
        self.teams = sorted(set(df["HomeTeam"]) | set(df["AwayTeam"]))
        idx = {t: i for i, t in enumerate(self.teams)}
        n = len(self.teams)

        h = df["HomeTeam"].map(idx).to_numpy()
        a = df["AwayTeam"].map(idx).to_numpy()
        hg = df["FTHG"].to_numpy(dtype=int)
        ag = df["FTAG"].to_numpy(dtype=int)
        w = np.ones(len(df)) if weights is None else np.asarray(weights, dtype=float)

        def unpack(p):
            home_adv, rho = p[0], p[1]
            atk = p[2 : 2 + n]
            dfc = p[2 + n : 2 + 2 * n]
            return home_adv, rho, atk, dfc

        def neg_log_like(p):
            home_adv, rho, atk, dfc = unpack(p)
            atk = atk - atk.mean()
            dfc = dfc - dfc.mean()
            lam = np.exp(home_adv + atk[h] - dfc[a])
            mu = np.exp(atk[a] - dfc[h])
            tau = self._tau(hg, ag, lam, mu, rho)
            ll = np.log(tau) + poisson.logpmf(hg, lam) + poisson.logpmf(ag, mu)
            return -(w * ll).sum()

        x0 = np.concatenate([[0.25, -0.05], np.zeros(n), np.zeros(n)])
        res = minimize(neg_log_like, x0, method="L-BFGS-B")

        home_adv, rho, atk, dfc = unpack(res.x)
        atk = atk - atk.mean()
        dfc = dfc - dfc.mean()
        self.home_adv, self.rho = home_adv, rho
        self.attack = dict(zip(self.teams, atk))
        self.defence = dict(zip(self.teams, dfc))
        return self

    def score_matrix(
        self, home: str, away: str, max_goals: int = 10
    ) -> np.ndarray:
        lam = np.exp(
            self.home_adv + self.attack[home] - self.defence[away]
        )
        mu = np.exp(self.attack[away] - self.defence[home])
        gh = np.arange(max_goals + 1)
        m = np.outer(poisson.pmf(gh, lam), poisson.pmf(gh, mu))
        m[0, 0] *= 1 - lam * mu * self.rho
        m[0, 1] *= 1 + lam * self.rho
        m[1, 0] *= 1 + mu * self.rho
        m[1, 1] *= 1 - self.rho
        return m / m.sum()


# --------------------------------------------------------------------------- #
#  Helper: Over/Under from score matrix or Poisson total                      #
# --------------------------------------------------------------------------- #
def total_goals_pmf(score_matrix: np.ndarray) -> np.ndarray:
    """Marginal PMF of total goals from a home x away score matrix."""
    max_total = 2 * (score_matrix.shape[0] - 1)
    pmf = np.zeros(max_total + 1)
    for h in range(score_matrix.shape[0]):
        for a in range(score_matrix.shape[1]):
            pmf[h + a] += score_matrix[h, a]
    return pmf


def over_under_from_matrix(
    score_matrix: np.ndarray, line: float
) -> tuple[float, float]:
    """P(over line), P(under line) from the full score-matrix total-goals PMF."""
    pmf = total_goals_pmf(score_matrix)
    k = int(np.floor(line))
    p_under = pmf[: k + 1].sum()
    return 1 - p_under, p_under


def over_under(total_lambda: float, line: float) -> tuple[float, float]:
    """P(over line), P(under line) for a Poisson(total_lambda) total."""
    k = int(np.floor(line))
    p_under = poisson.cdf(k, total_lambda)
    return 1 - p_under, p_under


# --------------------------------------------------------------------------- #
#  Backtesting metrics                                                        #
# --------------------------------------------------------------------------- #
@dataclass
class BacktestMetrics:
    n_test: int
    brier_1x2: float
    log_loss_1x2: float
    accuracy_1x2: float
    brier_ou: Dict[float, float] = field(default_factory=dict)
    mae_goals: float = 0.0
    mae_shots: Optional[float] = None
    mae_sot: Optional[float] = None
    mae_offsides: Optional[float] = None

    def __str__(self) -> str:
        lines = [
            "\n=== Backtest Results ===",
            f"  Test fixtures        : {self.n_test}",
            f"  1X2 Brier score      : {self.brier_1x2:.4f}",
            f"  1X2 Log loss         : {self.log_loss_1x2:.4f}",
            f"  1X2 Accuracy         : {self.accuracy_1x2:.1%}",
            f"  Goals MAE (total)    : {self.mae_goals:.3f}",
        ]
        for line, brier in sorted(self.brier_ou.items()):
            lines.append(f"  O/U {line} Brier score   : {brier:.4f}")
        if self.mae_shots is not None:
            lines.append(f"  Shots MAE (total)    : {self.mae_shots:.3f}")
        if self.mae_sot is not None:
            lines.append(f"  SOT MAE (total)      : {self.mae_sot:.3f}")
        if self.mae_offsides is not None:
            lines.append(f"  Offsides MAE (total) : {self.mae_offsides:.3f}")
        return "\n".join(lines)


def _actual_outcome(hg: int, ag: int) -> np.ndarray:
    """One-hot [home, draw, away]."""
    if hg > ag:
        return np.array([1.0, 0.0, 0.0])
    if hg == ag:
        return np.array([0.0, 1.0, 0.0])
    return np.array([0.0, 0.0, 1.0])


# --------------------------------------------------------------------------- #
#  Top-level engine that ties every market together                           #
# --------------------------------------------------------------------------- #
@dataclass
class Prediction:
    home: str
    away: str
    p_home: float
    p_draw: float
    p_away: float
    exp_home_goals: float
    exp_away_goals: float
    goals_over_under: Dict[float, tuple] = field(default_factory=dict)
    shots: Optional[tuple] = None
    shots_on_target: Optional[tuple] = None
    offsides: Optional[tuple] = None

    def __str__(self) -> str:
        L = [
            f"\n=== {self.home} (home) vs {self.away} (away) ===",
            f"  Win  {self.home:<14}: {self.p_home:6.1%}",
            f"  Draw {'':<14}: {self.p_draw:6.1%}",
            f"  Win  {self.away:<14}: {self.p_away:6.1%}",
            f"  Expected goals       : {self.exp_home_goals:.2f} - "
            f"{self.exp_away_goals:.2f}",
        ]
        for line, (ov, un) in self.goals_over_under.items():
            L.append(
                f"  Goals O/U {line:<4}        : "
                f"Over {ov:5.1%} | Under {un:5.1%}"
            )
        if self.shots:
            L.append(
                f"  Total shots (exp)    : {self.shots[0]:.1f} - "
                f"{self.shots[1]:.1f}  (match total {sum(self.shots):.1f})"
            )
        if self.shots_on_target:
            L.append(
                f"  Shots on target (exp): {self.shots_on_target[0]:.1f} - "
                f"{self.shots_on_target[1]:.1f}"
            )
        if self.offsides:
            L.append(
                f"  Offsides (exp)       : {self.offsides[0]:.1f} - "
                f"{self.offsides[1]:.1f}"
            )
        return "\n".join(L)


class FootballPredictor:
    def __init__(self, ou_lines=(1.5, 2.5, 3.5), decay_xi: float = 0.002):
        self.goals = DixonColesModel()
        self.shots_model: Optional[PoissonStrengthModel] = None
        self.sot_model: Optional[PoissonStrengthModel] = None
        self.offsides_model: Optional[PoissonStrengthModel] = None
        self.ou_lines = ou_lines
        self.decay_xi = decay_xi
        self.match_weights: Optional[np.ndarray] = None

    def _load_df(self, data) -> pd.DataFrame:
        df = pd.read_csv(data) if isinstance(data, str) else data.copy()
        required = {"HomeTeam", "AwayTeam", "FTHG", "FTAG"}
        if not required.issubset(df.columns):
            raise ValueError(f"CSV must contain columns: {required}")
        return prepare_match_data(df)

    def fit(self, data) -> "FootballPredictor":
        df = self._load_df(data)
        self.match_weights = compute_time_weights(df, self.decay_xi)

        self.goals.fit(df, weights=self.match_weights)

        if {"HS", "AS"}.issubset(df.columns):
            self.shots_model = PoissonStrengthModel("shots").fit(
                df, "HS", "AS", weights=self.match_weights
            )
        if {"HST", "AST"}.issubset(df.columns):
            self.sot_model = PoissonStrengthModel("sot").fit(
                df, "HST", "AST", weights=self.match_weights
            )
        if {"HO", "AO"}.issubset(df.columns):
            self.offsides_model = PoissonStrengthModel("offsides").fit(
                df, "HO", "AO", weights=self.match_weights
            )
        return self

    def predict(self, home: str, away: str) -> Prediction:
        for t in (home, away):
            if t not in self.goals.teams:
                raise ValueError(
                    f"Unknown team '{t}'. Known teams: {self.goals.teams}"
                )

        m = self.goals.score_matrix(home, away)
        p_home = np.tril(m, -1).sum()
        p_draw = np.trace(m)
        p_away = np.triu(m, 1).sum()

        gh = np.arange(m.shape[0])
        exp_h = (m.sum(axis=1) * gh).sum()
        exp_a = (m.sum(axis=0) * gh).sum()

        ou = {
            line: over_under_from_matrix(m, line) for line in self.ou_lines
        }

        pred = Prediction(
            home, away, p_home, p_draw, p_away, exp_h, exp_a, ou
        )

        if self.shots_model:
            pred.shots = self.shots_model.expected(home, away)
        if self.sot_model:
            pred.shots_on_target = self.sot_model.expected(home, away)
        if self.offsides_model:
            pred.offsides = self.offsides_model.expected(home, away)
        return pred

    def backtest(
        self,
        data,
        test_fraction: float = 0.2,
        min_train: int = 100,
    ) -> BacktestMetrics:
        df = self._load_df(data)
        n = len(df)
        n_test = max(1, int(n * test_fraction))
        n_train = n - n_test

        if n_train < min_train:
            raise ValueError(
                f"Not enough training data: {n_train} rows "
                f"(min_train={min_train}). Need more matches or lower "
                f"test_fraction."
            )

        train_df = df.iloc[:n_train].reset_index(drop=True)
        test_df = df.iloc[n_train:].reset_index(drop=True)

        engine = FootballPredictor(
            ou_lines=self.ou_lines, decay_xi=self.decay_xi
        )
        engine.fit(train_df)

        brier_sum = 0.0
        log_loss_sum = 0.0
        correct = 0
        goals_err_sum = 0.0
        ou_brier: Dict[float, float] = {line: 0.0 for line in self.ou_lines}
        shots_err: list[float] = []
        sot_err: list[float] = []
        off_err: list[float] = []

        eps = 1e-15
        n_eval = 0

        for _, row in test_df.iterrows():
            home, away = row["HomeTeam"], row["AwayTeam"]
            if home not in engine.goals.teams or away not in engine.goals.teams:
                continue

            n_eval += 1
            pred = engine.predict(home, away)
            hg, ag = int(row["FTHG"]), int(row["FTAG"])
            probs = np.array([pred.p_home, pred.p_draw, pred.p_away])
            actual = _actual_outcome(hg, ag)

            brier_sum += np.sum((probs - actual) ** 2)
            log_loss_sum -= np.log(np.clip(probs @ actual, eps, 1.0))
            if np.argmax(probs) == np.argmax(actual):
                correct += 1

            actual_total = hg + ag
            exp_total = pred.exp_home_goals + pred.exp_away_goals
            goals_err_sum += abs(exp_total - actual_total)

            for line in self.ou_lines:
                ov, un = pred.goals_over_under[line]
                went_over = 1.0 if actual_total > line else 0.0
                ou_brier[line] += (ov - went_over) ** 2

            if engine.shots_model and {"HS", "AS"}.issubset(row.index):
                exp_sh = sum(engine.shots_model.expected(home, away))
                shots_err.append(abs(exp_sh - (row["HS"] + row["AS"])))

            if engine.sot_model and {"HST", "AST"}.issubset(row.index):
                exp_sot = sum(engine.sot_model.expected(home, away))
                sot_err.append(abs(exp_sot - (row["HST"] + row["AST"])))

            if engine.offsides_model and {"HO", "AO"}.issubset(row.index):
                exp_off = sum(engine.offsides_model.expected(home, away))
                off_err.append(abs(exp_off - (row["HO"] + row["AO"])))

        if n_eval == 0:
            raise ValueError("No test fixtures could be evaluated.")

        return BacktestMetrics(
            n_test=n_eval,
            brier_1x2=brier_sum / n_eval,
            log_loss_1x2=log_loss_sum / n_eval,
            accuracy_1x2=correct / n_eval,
            brier_ou={line: v / n_eval for line, v in ou_brier.items()},
            mae_goals=goals_err_sum / n_eval,
            mae_shots=np.mean(shots_err) if shots_err else None,
            mae_sot=np.mean(sot_err) if sot_err else None,
            mae_offsides=np.mean(off_err) if off_err else None,
        )


# --------------------------------------------------------------------------- #
#  Demo with synthetic data so the file runs out-of-the-box                   #
# --------------------------------------------------------------------------- #
def _make_demo_data(seed: int = 7, n_seasons: int = 3) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    teams = [
        "Arsenal",
        "Chelsea",
        "Liverpool",
        "ManCity",
        "Spurs",
        "Everton",
        "Leeds",
        "Brighton",
    ]
    strength = {t: rng.normal(0, 0.35) for t in teams}
    rows = []
    base_date = pd.Timestamp("2021-08-01")
    match_idx = 0
    for _ in range(n_seasons):
        for h in teams:
            for a in teams:
                if h == a:
                    continue
                lam = np.exp(0.25 + strength[h] - strength[a] * 0.8)
                mu = np.exp(strength[a] - strength[h] * 0.8)
                hg, ag = rng.poisson(lam), rng.poisson(mu)
                rows.append(
                    dict(
                        Date=(base_date + pd.Timedelta(days=match_idx * 3)).strftime(
                            "%d/%m/%Y"
                        ),
                        HomeTeam=h,
                        AwayTeam=a,
                        FTHG=hg,
                        FTAG=ag,
                        HS=rng.poisson(12 + 4 * strength[h]),
                        AS=rng.poisson(10 + 4 * strength[a]),
                        HST=rng.poisson(5 + 2 * strength[h]),
                        AST=rng.poisson(4 + 2 * strength[a]),
                        HO=rng.poisson(2.2),
                        AO=rng.poisson(2.0),
                    )
                )
                match_idx += 1
    return pd.DataFrame(rows)


if __name__ == "__main__":
    demo = _make_demo_data()
    engine = FootballPredictor(decay_xi=0.002).fit(demo)

    print(engine.predict("Arsenal", "Chelsea"))
    print(engine.predict("Everton", "ManCity"))

    metrics = FootballPredictor(decay_xi=0.002).backtest(demo, test_fraction=0.2)
    print(metrics)
