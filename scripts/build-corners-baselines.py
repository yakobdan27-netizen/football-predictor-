"""Encode data/corners-baselines.csv → data/corners-baselines.json."""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "corners-baselines.csv"
OUT_PATH = ROOT / "data" / "corners-baselines.json"


def main() -> None:
    rows: list[dict] = []
    with CSV_PATH.open(encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(
                {
                    "league": r["league"].strip(),
                    "season": r["season"].strip(),
                    "clubName": r["club"].strip(),
                    "matches": int(r["matches"]),
                    "avgCornersWon": float(r["avg_corners_won"]),
                    "avgCornersConceded": float(r["avg_corners_conceded"]),
                    "cornerDiff": float(r["corner_diff"]),
                    "pctMatchesOver95Total": int(r["pct_matches_over_9_5_total"]),
                    "pctMatchesOver45Team": int(r["pct_matches_over_4_5_team"]),
                }
            )
    OUT_PATH.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} rows -> {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
