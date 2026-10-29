"""Compare our reviews with chess.com's Game Review and suggest thresholds.

    python scripts/calibrate.py calibration.yaml [--search]

For each game in the file (see calibration.example.yaml) it reports:
  - accuracy difference per player (ours - chess.com)
  - estimated game rating difference
  - classification count differences
  - per-move label agreement and a confusion list
With --search it grid-searches the Excellent/Good/Inaccuracy/Mistake
thresholds (re-classifying only; the engine runs once per game) and prints
the set that agrees best with chess.com.
"""

from __future__ import annotations

import itertools
import math
import statistics
import sys
from collections import Counter
from pathlib import Path

import typer
import yaml
from rich.console import Console
from rich.table import Table

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.analysis.classify import ORDER
from backend.analysis.review import build_review
from backend.cli import evaluation_for, meta_for
from backend.config import get_config
from backend.fetch import ChessComClient
from backend.report.schema import Review

console = Console()
app = typer.Typer(add_completion=False)


def move_key(m) -> str:
    return f"{m.move_number}{'.' if m.color == 'white' else '...'}{m.san}"


def score(reviews: list[tuple[Review, dict, str]]) -> tuple[float, float]:
    """(per-move agreement 0-1, mean absolute count error)."""
    agree = total = 0
    count_err = []
    for r, entry, me in reviews:
        labels = entry.get("moves") or {}
        by_key = {move_key(m): m.classification for m in r.moves}
        for k, v in labels.items():
            if k in by_key:
                total += 1
                agree += by_key[k] == v
        for who, color in (("me", me), ("opponent", "black" if me == "white" else "white")):
            want = (entry.get("counts") or {}).get(who)
            if want:
                ours = getattr(r, color).counts
                count_err += [abs(ours[c.value] - want.get(c.value, 0)) for c in ORDER]
    return (agree / total if total else float("nan"),
            statistics.mean(count_err) if count_err else float("nan"))


@app.command()
def main(path: Path, search: bool = typer.Option(False, help="Grid-search loss thresholds")):
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    cfg = get_config()
    user = data["username"]
    evals = []
    with ChessComClient(cfg) as c:
        for entry in data["games"]:
            g = c.find_game(user, entry["url"])
            console.print(f"[bold]{g.url}[/bold]")
            evals.append((evaluation_for(cfg, g), g, entry))

    reviews = []
    acc_err, rating_err = [], []
    confusion: Counter = Counter()
    t = Table(title="Ours vs chess.com")
    for col in ("Game", "Player", "Acc ours", "Acc c.com", "Δ", "Rating ours", "Rating c.com",
                "Count err"):
        t.add_column(col, justify="right")
    for ev, g, entry in evals:
        r = build_review(ev, cfg, meta_for(g), pgn=g.pgn)
        me = g.color_of(user)
        reviews.append((r, entry, me))
        for who, color in (("me", me), ("opponent", "black" if me == "white" else "white")):
            p = getattr(r, color)
            want_acc = (entry.get("accuracy") or {}).get(who)
            want_rt = (entry.get("game_rating") or {}).get(who)
            want_counts = (entry.get("counts") or {}).get(who)
            d = None if want_acc is None or p.accuracy is None else p.accuracy - want_acc
            if d is not None:
                acc_err.append(d)
            if want_rt is not None and p.game_rating is not None:
                rating_err.append(p.game_rating - want_rt)
            ce = (sum(abs(p.counts[c.value] - want_counts.get(c.value, 0)) for c in ORDER)
                  if want_counts else None)
            t.add_row(g.game_id, f"{who} ({p.username})", f"{p.accuracy:.1f}",
                      "-" if want_acc is None else f"{want_acc:.1f}",
                      "-" if d is None else f"{d:+.1f}", str(p.game_rating),
                      "-" if want_rt is None else str(want_rt), "-" if ce is None else str(ce))
        by_key = {move_key(m): m.classification for m in r.moves}
        for k, v in (entry.get("moves") or {}).items():
            ours = by_key.get(k, "?")
            if ours != v:
                confusion[(v, ours)] += 1
    console.print(t)

    if acc_err:
        console.print(f"Accuracy: mean Δ {statistics.mean(acc_err):+.1f}, "
                      f"mean |Δ| {statistics.mean(map(abs, acc_err)):.1f} over {len(acc_err)}")
    if rating_err:
        console.print(f"Game rating: mean Δ {statistics.mean(rating_err):+.0f}. A consistent "
                      f"offset means shifting rating.curve by that amount.")
    agree, cerr = score(reviews)
    console.print(f"Per-move agreement: {agree:.0%}   mean count error per class: {cerr:.2f}")
    if confusion:
        console.print("Most common disagreements (chess.com -> ours):")
        for (want, ours), n in confusion.most_common(10):
            console.print(f"  {want:>10} -> {ours:<10} x{n}")

    if not search:
        return
    console.print("\nSearching thresholds...")
    c0 = cfg.classification.model_copy()
    grid = {
        "excellent": [0.01, 0.015, 0.02, 0.03],
        "good": [0.04, 0.05, 0.06, 0.07],
        "inaccuracy": [0.08, 0.10, 0.12, 0.14],
        "mistake": [0.16, 0.20, 0.24, 0.28],
    }
    best = None
    for combo in itertools.product(*grid.values()):
        if not combo[0] < combo[1] < combo[2] < combo[3]:
            continue
        for k, v in zip(grid, combo, strict=True):
            setattr(cfg.classification, k, v)
        trial = [(build_review(ev, cfg, meta_for(g), pgn=g.pgn), entry, g.color_of(user))
                 for ev, g, entry in evals]
        a, e = score(trial)
        key = (-(0 if math.isnan(a) else a), 0 if math.isnan(e) else e)  # agreement first
        if best is None or key < best[0]:
            best = (key, dict(zip(grid, combo, strict=True)), a, e)
    cfg.classification = c0
    _, values, a, e = best
    console.print(f"Best: {values}  agreement {a:.0%}, count error {e:.2f}")
    console.print("Put these under `classification:` in config.yaml to use them.")


if __name__ == "__main__":
    app()
