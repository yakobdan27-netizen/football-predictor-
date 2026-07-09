"""Normalize raw football-data.co.uk CSVs to the standard schema."""

from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path

from ingestion.config import DOMESTIC_CODES, RAW_DIR, CLEAN_DIR
from ingestion.schema import SOURCE_COLUMN_MAP, STANDARD_COLUMNS


def parse_football_date(raw: str) -> str:
    """Parse dd/mm/yy or dd/mm/yyyy to ISO yyyy-mm-dd."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw


def _int_or_blank(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    try:
        return str(int(float(value)))
    except ValueError:
        return ""


def _float_or_blank(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    try:
        f = float(value)
        return str(f) if f > 1 else ""
    except ValueError:
        return ""


def clean_raw_file(
    raw_path: Path,
    *,
    league: str,
    season: str,
    source_url: str,
    source_label: str = "football-data.co.uk",
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with raw_path.open(encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            home_goals = _int_or_blank(raw.get("FTHG", ""))
            away_goals = _int_or_blank(raw.get("FTAG", ""))
            if not home_goals or not away_goals:
                continue

            home_team = (raw.get("HomeTeam") or "").strip()
            away_team = (raw.get("AwayTeam") or "").strip()
            if not home_team or not away_team:
                continue

            out: dict[str, str] = {col: "" for col in STANDARD_COLUMNS}
            out["date"] = parse_football_date(raw.get("Date", ""))
            out["home_team"] = home_team
            out["away_team"] = away_team
            out["home_goals"] = home_goals
            out["away_goals"] = away_goals

            for src_col, std_col in SOURCE_COLUMN_MAP.items():
                if std_col in {"date", "home_team", "away_team", "home_goals", "away_goals"}:
                    continue
                if std_col == "result":
                    out[std_col] = (raw.get(src_col) or "").strip()
                elif std_col.startswith("b365_"):
                    out[std_col] = _float_or_blank(raw.get(src_col, ""))
                else:
                    out[std_col] = _int_or_blank(raw.get(src_col, ""))

            out["league"] = league
            out["season"] = season
            out["source"] = source_label
            out["source_url"] = source_url
            rows.append(out)
    return rows


def clean_domestic_raw(
    raw_dir: str = RAW_DIR,
    clean_dir: str = CLEAN_DIR,
    manifest_rows: list[dict[str, str]] | None = None,
) -> list[Path]:
    manifest_rows = manifest_rows or []
    url_by_file = {r["file_path"]: r.get("source_url", "") for r in manifest_rows}
    Path(clean_dir).mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []

    for raw_path in sorted(Path(raw_dir).glob("*_*.csv")):
        name = raw_path.stem  # e.g. E0_2425
        parts = name.split("_", 1)
        if len(parts) != 2:
            continue
        code, season = parts
        if code not in DOMESTIC_CODES:
            continue

        league = DOMESTIC_CODES[code]
        source_url = url_by_file.get(str(raw_path).replace("\\", "/"), "")
        if not source_url:
            source_url = url_by_file.get(str(raw_path), "")

        cleaned = clean_raw_file(
            raw_path,
            league=league,
            season=season,
            source_url=source_url,
        )
        out_path = Path(clean_dir) / f"{code}_{season}_clean.csv"
        write_clean_csv(out_path, cleaned)
        outputs.append(out_path)
        print(f"  cleaned {raw_path.name}: {len(cleaned)} rows -> {out_path.name}")

    return outputs


def write_clean_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=STANDARD_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
