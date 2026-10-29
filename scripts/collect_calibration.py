"""Collect games that chess.com has already scored, for accuracy calibration.

    python scripts/collect_calibration.py [--per-band 12] [--seed ramisalahh]

chess.com's Published-Data API includes `accuracies` (white/black) for games
that were analysed. Starting from the seed player(s), this walks to opponents
of different strengths (one request at a time, cached) until every rating
band has enough games, and writes calibration/dataset.jsonl.
"""

from __future__ import annotations

import heapq
import json
import sys
from pathlib import Path

import typer

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.config import load_config  # noqa: E402
from backend.fetch import ChessComClient, ChessComError  # noqa: E402

OUT = ROOT / "calibration" / "dataset.jsonl"
BANDS = [(0, 800), (800, 1300), (1300, 1800), (1800, 2300), (2300, 4000)]
TIME_CLASSES = {"rapid", "blitz"}

app = typer.Typer(add_completion=False)


def band_of(rating: float) -> int:
    return next(i for i, (lo, hi) in enumerate(BANDS) if lo <= rating < hi)


def usable(g: dict) -> bool:
    acc = g.get("accuracies") or {}
    return (g.get("rules") == "chess" and g.get("rated") and g.get("time_class") in TIME_CLASSES
            and acc.get("white") is not None and acc.get("black") is not None
            and g.get("pgn", "").count(".") >= 25)  # at least ~20 moves


@app.command()
def main(
    per_band: int = typer.Option(12, help="Games per rating band"),
    seed: list[str] = typer.Option(["ramisalahh"], help="Starting players"),
    max_players: int = typer.Option(120, help="Stop after looking at this many players"),
    per_player: int = typer.Option(3, help="At most this many games from one player"),
):
    cfg = load_config(ROOT / "config.yaml")
    picked: dict[str, dict] = {}
    counts = [0] * len(BANDS)
    queue: list[tuple[float, str]] = [(0.0, s.lower()) for s in seed]
    seen: set[str] = set()

    def need() -> list[int]:
        return [i for i, c in enumerate(counts) if c < per_band]

    with ChessComClient(cfg) as client:
        while queue and need() and len(seen) < max_players:
            _, user = heapq.heappop(queue)
            if user in seen:
                continue
            seen.add(user)
            try:
                archives = client.archives(user)
            except ChessComError:
                continue
            taken = 0
            for url in reversed(archives[-2:]):  # the two latest months
                try:
                    games = client.month_raw(url)
                except ChessComError:
                    continue
                for g in games:
                    if not usable(g) or g["url"] in picked or taken >= per_player:
                        continue
                    avg = (g["white"]["rating"] + g["black"]["rating"]) / 2
                    b = band_of(avg)
                    if counts[b] < per_band:
                        picked[g["url"]] = {
                            "url": g["url"], "pgn": g["pgn"], "time_class": g["time_class"],
                            "white": g["white"]["username"], "black": g["black"]["username"],
                            "white_rating": g["white"]["rating"],
                            "black_rating": g["black"]["rating"],
                            "api_white": g["accuracies"]["white"],
                            "api_black": g["accuracies"]["black"],
                        }
                        counts[b] += 1
                        taken += 1
                    # walk toward the bands that still need games
                    targets = [(lo + hi) / 2 for i, (lo, hi) in enumerate(BANDS) if i in need()]
                    for side in ("white", "black"):
                        opp = g[side]["username"].lower()
                        if opp not in seen and targets:
                            dist = min(abs(g[side]["rating"] - t) for t in targets)
                            heapq.heappush(queue, (dist, opp))
            print(f"{user:<24} picked {taken}  bands {counts}", flush=True)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        for row in picked.values():
            f.write(json.dumps(row) + "\n")
    print(f"\n{len(picked)} games from {len(seen)} players -> {OUT.relative_to(ROOT)}")
    for (lo, hi), c in zip(BANDS, counts, strict=True):
        print(f"  {lo:>4}-{hi:<4}: {c}")


if __name__ == "__main__":
    app()
