"""DEPRECATED: Optional offline script — not used by the web app.

The Football Predictor application is fully manual and does not call external
football APIs. This module remains for reference only.
"""

"""Fetch UEFA and national-team fixtures via API-Football (traceable JSON API)."""

from __future__ import annotations

import csv
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from ingestion.config import CLEAN_DIR, RAW_DIR, last_n_season_codes
from ingestion.schema import STANDARD_COLUMNS

API_BASE = "https://v3.football.api-sports.io"

# API-Football league IDs (documented at api-football.com/documentation-v3)
NAT_COMPETITIONS: dict[int, str] = {
    2: "UEFA Champions League",
    3: "UEFA Europa League",
    848: "UEFA Europa Conference League",
    5: "UEFA Nations League",
    1: "World Cup",
}


def _api_key() -> str | None:
    key = (os.environ.get("API_FOOTBALL_KEY") or "").strip()
    if not key or key.lower() in {"your_api_key_here", "changeme"}:
        return None
    return key


def _api_get(path: str, params: dict[str, str | int], api_key: str) -> dict:
    query = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{API_BASE}{path}?{query}"
    req = urllib.request.Request(
        url,
        headers={"x-apisports-key": api_key, "Accept": "application/json"},
    )
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            errors = payload.get("errors")
            if errors:
                raise RuntimeError(f"API errors: {errors}")
            return payload
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, RuntimeError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2**attempt)
    raise RuntimeError(f"API request failed for {url}: {last_error}")


def _finished_fixtures(league_id: int, season: int, api_key: str) -> list[dict]:
    payload = _api_get(
        "/fixtures",
        {"league": league_id, "season": season, "status": "FT"},
        api_key,
    )
    return payload.get("response") or []


def _fixture_statistics(fixture_id: int, api_key: str) -> dict[str, dict[str, int | None]]:
    """Return home/away stat map; empty if unavailable on free tier."""
    try:
        payload = _api_get("/fixtures/statistics", {"fixture": fixture_id}, api_key)
    except RuntimeError:
        return {"home": {}, "away": {}}

    out: dict[str, dict[str, int | None]] = {"home": {}, "away": {}}
    response = payload.get("response") or []
    for idx, block in enumerate(response[:2]):
        side = "home" if idx == 0 else "away"
        stats: dict[str, int | None] = {}
        for s in block.get("statistics") or []:
            val = s.get("value")
            if isinstance(val, str) and val.endswith("%"):
                continue
            try:
                stats[s["type"]] = int(val) if val is not None else None
            except (TypeError, ValueError):
                stats[s["type"]] = None
        out[side] = stats
    return out


def _stat(stats: dict, *names: str) -> str:
    for name in names:
        val = stats.get(name)
        if val is not None and val != "":
            return str(int(val))
    return ""


def _map_fixture(
    item: dict,
    *,
    league_name: str,
    season: str,
    source_url: str,
    stats: dict[str, dict[str, int | None]] | None = None,
) -> dict[str, str]:
    fixture = item["fixture"]
    teams = item["teams"]
    goals = item["goals"]
    score = item.get("score") or {}

    hg = goals.get("home")
    ag = goals.get("away")
    if hg is None or ag is None:
        return {}

    ht = score.get("halftime") or {}
    stats = stats or {"home": {}, "away": {}}

    row: dict[str, str] = {col: "" for col in STANDARD_COLUMNS}
    row["date"] = datetime.fromisoformat(
        fixture["date"].replace("Z", "+00:00")
    ).strftime("%Y-%m-%d")
    row["home_team"] = teams["home"]["name"]
    row["away_team"] = teams["away"]["name"]
    row["home_goals"] = str(int(hg))
    row["away_goals"] = str(int(ag))

    if ht.get("home") is not None and ht.get("away") is not None:
        row["ht_home_goals"] = str(int(ht["home"]))
        row["ht_away_goals"] = str(int(ht["away"]))

    if teams["home"].get("winner") is True:
        row["result"] = "H"
    elif teams["away"].get("winner") is True:
        row["result"] = "A"
    elif int(hg) == int(ag):
        row["result"] = "D"

    row["home_shots"] = _stat(stats["home"], "Total Shots")
    row["away_shots"] = _stat(stats["away"], "Total Shots")
    row["home_sot"] = _stat(stats["home"], "Shots on Goal")
    row["away_sot"] = _stat(stats["away"], "Shots on Goal")
    row["home_corners"] = _stat(stats["home"], "Corner Kicks")
    row["away_corners"] = _stat(stats["away"], "Corner Kicks")

    row["league"] = f"NAT: {league_name}"
    row["season"] = season
    row["source"] = "api-football.com"
    row["source_url"] = source_url
    return row


def fetch_national(
    raw_dir: str = RAW_DIR,
    clean_dir: str = CLEAN_DIR,
    include_statistics: bool = False,
) -> tuple[Path | None, list[str]]:
    """
    Download finished international fixtures and write NAT_clean.csv.
    Returns (output_path, log_messages).
    """
    api_key = _api_key()
    logs: list[str] = []
    if not api_key:
        logs.append("API_FOOTBALL_KEY not set; skipping NAT module.")
        return None, logs

    Path(raw_dir).mkdir(parents=True, exist_ok=True)
    Path(clean_dir).mkdir(parents=True, exist_ok=True)

    season_codes = last_n_season_codes()
    # API-Football season is calendar year the season ends in (e.g. 2025 for 2024/25 UCL)
    api_seasons = sorted({2000 + int(code[2:4]) for code in season_codes})

    all_rows: list[dict[str, str]] = []
    raw_snapshot = Path(raw_dir) / "nat_api_snapshot.jsonl"

    with raw_snapshot.open("w", encoding="utf-8") as snap:
        for league_id, league_name in NAT_COMPETITIONS.items():
            for season in api_seasons:
                source_url = f"{API_BASE}/fixtures?league={league_id}&season={season}&status=FT"
                logs.append(f"Fetching {league_name} {season}...")
                try:
                    fixtures = _finished_fixtures(league_id, season, api_key)
                except RuntimeError as exc:
                    logs.append(f"  skipped: {exc}")
                    continue

                for item in fixtures:
                    snap.write(json.dumps({"league_id": league_id, "season": season, "item": item}))
                    snap.write("\n")

                    stats = None
                    if include_statistics:
                        fid = item["fixture"]["id"]
                        stats = _fixture_statistics(fid, api_key)
                        time.sleep(0.2)  # rate limit courtesy

                    row = _map_fixture(
                        item,
                        league_name=league_name,
                        season=str(season),
                        source_url=source_url,
                        stats=stats,
                    )
                    if row:
                        all_rows.append(row)

                logs.append(f"  {league_name} {season}: {len(fixtures)} finished fixtures")
                time.sleep(0.3)

    out_path = Path(clean_dir) / "NAT_clean.csv"
    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=STANDARD_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(all_rows)

    logs.append(f"NAT module wrote {len(all_rows)} rows -> {out_path}")
    return out_path, logs
