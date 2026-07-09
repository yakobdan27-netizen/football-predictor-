"""Fetch raw CSV files from football-data.co.uk with retries and manifest tracking."""

from __future__ import annotations

import csv
import hashlib
import time
from datetime import datetime, timezone
from http.client import RemoteDisconnected
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from ingestion.config import (
    BASE_SEASON_URL,
    FIXTURES_URL,
    MANIFEST_PATH,
    RAW_DIR,
    USER_AGENT,
    current_season_code,
    download_pairs,
)
from ingestion.schema import MANIFEST_COLUMNS, MISSING_MARKETS_NOTE


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _count_rows(path: Path) -> int:
    with path.open(encoding="utf-8-sig", errors="replace") as f:
        return max(sum(1 for _ in f) - 1, 0)


def load_manifest(path: str = MANIFEST_PATH) -> list[dict[str, str]]:
    p = Path(path)
    if not p.exists():
        return []
    with p.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def save_manifest(rows: list[dict[str, str]], path: str = MANIFEST_PATH) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=MANIFEST_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def manifest_index(rows: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    return {r["file_path"]: r for r in rows if r.get("file_path")}


def fetch_url(url: str, dest: Path, attempts: int = 3) -> bool:
    """Download URL to dest. Returns False if resource not found (404)."""
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(req, timeout=90) as resp:
                data = resp.read()
            if not data.strip():
                raise ValueError(f"Empty response from {url}")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            return True
        except HTTPError as exc:
            if exc.code == 404:
                print(f"  not found (404): {url}")
                return False
            last_error = exc
        except (URLError, TimeoutError, ValueError, RemoteDisconnected, OSError) as exc:
            last_error = exc
        if attempt < attempts - 1:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Failed to download {url} after {attempts} attempts: {last_error}")


def _upsert_manifest_entry(
    manifest: list[dict[str, str]],
    *,
    file_path: str,
    source_url: str,
    immutable: bool,
    notes: str = "",
) -> list[dict[str, str]]:
    path = Path(file_path)
    entry = {
        "file_path": file_path,
        "source_url": source_url,
        "download_timestamp": datetime.now(timezone.utc).isoformat(),
        "row_count": str(_count_rows(path)),
        "sha256_hash": _sha256(path),
        "immutable": "true" if immutable else "false",
        "notes": notes,
    }
    idx = manifest_index(manifest)
    idx[file_path] = entry
    return list(idx.values())


def should_skip_download(
    file_path: str,
    manifest: list[dict[str, str]],
    *,
    immutable: bool,
) -> bool:
    if not immutable:
        return False
    path = Path(file_path)
    existing = manifest_index(manifest).get(file_path)
    return path.exists() and existing is not None and existing.get("immutable") == "true"


def download_season_file(
    season: str,
    code: str,
    manifest: list[dict[str, str]],
    raw_dir: str = RAW_DIR,
) -> list[dict[str, str]]:
    url = BASE_SEASON_URL.format(season=season, code=code)
    dest = Path(raw_dir) / f"{code}_{season}.csv"
    immutable = season != current_season_code()

    if should_skip_download(str(dest), manifest, immutable=immutable):
        print(f"  skip (immutable): {dest.name}")
        return manifest

    print(f"  download: {url}")
    if not fetch_url(url, dest):
        return manifest
    time.sleep(0.5)
    return _upsert_manifest_entry(
        manifest,
        file_path=str(dest),
        source_url=url,
        immutable=immutable,
    )


def download_fixtures(manifest: list[dict[str, str]], raw_dir: str = RAW_DIR) -> list[dict[str, str]]:
    dest = Path(raw_dir) / "fixtures.csv"
    print(f"  download: {FIXTURES_URL}")
    if not fetch_url(FIXTURES_URL, dest):
        print("  warning: fixtures.csv unavailable")
        return manifest
    time.sleep(0.5)
    return _upsert_manifest_entry(
        manifest,
        file_path=str(dest),
        source_url=FIXTURES_URL,
        immutable=False,
        notes="Upcoming fixtures; rows without full-time scores are dropped during cleaning.",
    )


def download_all(raw_dir: str = RAW_DIR) -> list[dict[str, str]]:
    Path(raw_dir).mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()

    print("Downloading domestic league season files...")
    for season, code in download_pairs():
        manifest = download_season_file(season, code, manifest, raw_dir=raw_dir)

    print("Downloading upcoming fixtures snapshot...")
    manifest = download_fixtures(manifest, raw_dir=raw_dir)

    # Ensure missing-markets note is recorded once in manifest metadata row.
    meta_path = f"{raw_dir}/_missing_markets_note.txt"
    Path(meta_path).write_text(MISSING_MARKETS_NOTE, encoding="utf-8")
    manifest = _upsert_manifest_entry(
        manifest,
        file_path=meta_path,
        source_url="n/a",
        immutable=True,
        notes=MISSING_MARKETS_NOTE,
    )

    save_manifest(manifest)
    return manifest
