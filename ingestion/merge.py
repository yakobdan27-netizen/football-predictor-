"""Merge cleaned domestic and national CSVs into master_results.csv."""

from __future__ import annotations

import csv
from pathlib import Path

from ingestion.config import CLEAN_DIR, MASTER_PATH
from ingestion.schema import STANDARD_COLUMNS


def _dedupe_key(row: dict[str, str]) -> tuple[str, str, str, str]:
    return (
        row.get("date", ""),
        row.get("home_team", ""),
        row.get("away_team", ""),
        row.get("league", ""),
    )


def merge_clean_files(
    clean_dir: str = CLEAN_DIR,
    output_path: str = MASTER_PATH,
    extra_files: list[Path] | None = None,
) -> Path:
    paths = sorted(Path(clean_dir).glob("*_clean.csv"))
    if extra_files:
        paths = sorted(set(paths) | set(extra_files))

    merged: list[dict[str, str]] = []
    seen: set[tuple[str, str, str, str]] = set()

    for path in paths:
        with path.open(encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                key = _dedupe_key(row)
                if key in seen:
                    continue
                seen.add(key)
                merged.append({col: row.get(col, "") for col in STANDARD_COLUMNS})

    merged.sort(key=lambda r: (r.get("date", ""), r.get("league", ""), r.get("home_team", "")))

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=STANDARD_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(merged)

    print(f"Merged {len(merged)} rows -> {out}")
    return out
