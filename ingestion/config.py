"""Download targets and URL patterns for football-data.co.uk ingestion."""

from __future__ import annotations

from datetime import date

BASE_SEASON_URL = "https://www.football-data.co.uk/mmz4281/{season}/{code}.csv"
FIXTURES_URL = "https://www.football-data.co.uk/fixtures.csv"

DOMESTIC_CODES: dict[str, str] = {
    "E0": "Premier League",
    "SP1": "La Liga",
    "I1": "Serie A",
    "D1": "Bundesliga",
    "F1": "Ligue 1",
}

NUM_SEASONS = 3
RAW_DIR = "data/raw"
CLEAN_DIR = "data/clean"
MANIFEST_PATH = f"{RAW_DIR}/manifest.csv"
MASTER_PATH = f"{CLEAN_DIR}/master_results.csv"

USER_AGENT = "FootballIngestion/1.0 (+https://github.com/jacobs21983/football-predictor)"


def season_code_for_year(start_year: int) -> str:
    """Build football-data season code, e.g. 2024 -> '2425'."""
    start = start_year % 100
    end = (start_year + 1) % 100
    return f"{start:02d}{end:02d}"


def current_season_start_year(today: date | None = None) -> int:
    """European season starts in August."""
    today = today or date.today()
    return today.year if today.month >= 8 else today.year - 1


def current_season_code(today: date | None = None) -> str:
    return season_code_for_year(current_season_start_year(today))


def last_n_season_codes(n: int = NUM_SEASONS, today: date | None = None) -> list[str]:
    start = current_season_start_year(today)
    return [season_code_for_year(start - i) for i in range(n)]


def download_pairs(today: date | None = None) -> list[tuple[str, str]]:
    """(season, league_code) pairs for all five domestic leagues."""
    seasons = last_n_season_codes(NUM_SEASONS, today)
    return [(season, code) for season in seasons for code in DOMESTIC_CODES]
