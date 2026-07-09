#!/usr/bin/env python3
"""
End-to-end football data ingestion pipeline.

Usage:
    python -m ingestion.run_all

Schedule (cron / Task Scheduler):
    Run twice weekly (Monday and Friday) to refresh the current season and fixtures.
    Historical season files are immutable and skipped after the first successful download.

Outputs:
    data/clean/master_results.csv
    data/raw/manifest.csv
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow running as `python ingestion/run_all.py` from project root.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ingestion.cleaner import clean_domestic_raw
from ingestion.config import CLEAN_DIR, MASTER_PATH, RAW_DIR
from ingestion.downloader import download_all, load_manifest, save_manifest
from ingestion.merge import merge_clean_files
from ingestion.schema import MISSING_MARKETS_NOTE


def main() -> int:
    print("=== Football data ingestion ===\n")

    print("[1/4] Downloading raw sources...")
    manifest = download_all(raw_dir=RAW_DIR)

    print("\n[2/4] Cleaning domestic league files...")
    clean_domestic_raw(raw_dir=RAW_DIR, clean_dir=CLEAN_DIR, manifest_rows=manifest)

    print("\n[3/4] Skipping national / UEFA API fetch (app is fully manual; use CSV upload instead).")
    nat_path, nat_logs = None, ["Skipped — external football APIs are not used by this application."]
    for line in nat_logs:
        print(f"  {line}")

    if nat_path:
        manifest.append(
            {
                "file_path": str(nat_path),
                "source_url": "https://v3.football.api-sports.io/fixtures",
                "download_timestamp": "",
                "row_count": str(sum(1 for _ in nat_path.open(encoding="utf-8")) - 1),
                "sha256_hash": "",
                "immutable": "false",
                "notes": "NAT module via API-Football; refreshed each run when API_FOOTBALL_KEY is set.",
            }
        )

    print("\n[4/4] Merging master dataset...")
    master = merge_clean_files(clean_dir=CLEAN_DIR, output_path=MASTER_PATH)

    # Persist manifest with pipeline note.
    note_row = {
        "file_path": MASTER_PATH,
        "source_url": "merged",
        "download_timestamp": "",
        "row_count": str(sum(1 for _ in master.open(encoding="utf-8")) - 1),
        "sha256_hash": "",
        "immutable": "false",
        "notes": f"Master merge output. {MISSING_MARKETS_NOTE}",
    }
    manifest = [r for r in manifest if r.get("file_path") != MASTER_PATH]
    manifest.append(note_row)
    save_manifest(manifest)

    print("\nDone.")
    print(f"  Master:   {master}")
    print(f"  Manifest: {RAW_DIR}/manifest.csv")
    if not nat_path:
        print("  Note: National/UEFA data is not fetched automatically. Upload CSVs manually.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
