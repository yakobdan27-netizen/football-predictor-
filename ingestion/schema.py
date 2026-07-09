"""Standardized column schema shared by domestic and national modules."""

from __future__ import annotations

SOURCE_COLUMN_MAP: dict[str, str] = {
    "Date": "date",
    "HomeTeam": "home_team",
    "AwayTeam": "away_team",
    "FTHG": "home_goals",
    "FTAG": "away_goals",
    "FTR": "result",
    "HTHG": "ht_home_goals",
    "HTAG": "ht_away_goals",
    "HS": "home_shots",
    "AS": "away_shots",
    "HST": "home_sot",
    "AST": "away_sot",
    "HC": "home_corners",
    "AC": "away_corners",
    "B365H": "b365_home",
    "B365D": "b365_draw",
    "B365A": "b365_away",
    "B365>2.5": "b365_over25",
    "B365<2.5": "b365_under25",
}

STANDARD_COLUMNS: list[str] = [
    "date",
    "home_team",
    "away_team",
    "home_goals",
    "away_goals",
    "result",
    "ht_home_goals",
    "ht_away_goals",
    "home_shots",
    "away_shots",
    "home_sot",
    "away_sot",
    "home_corners",
    "away_corners",
    "b365_home",
    "b365_draw",
    "b365_away",
    "b365_over25",
    "b365_under25",
    "home_offsides",
    "away_offsides",
    "home_throwins",
    "away_throwins",
    "league",
    "season",
    "source",
    "source_url",
]

MANIFEST_COLUMNS: list[str] = [
    "file_path",
    "source_url",
    "download_timestamp",
    "row_count",
    "sha256_hash",
    "immutable",
    "notes",
]

MISSING_MARKETS_NOTE = (
    "home_offsides, away_offsides, home_throwins, away_throwins are not "
    "available from football-data.co.uk or the free API tier; columns are "
    "present but left blank. Premium statistics providers required."
)
