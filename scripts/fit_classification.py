"""Fit the classification thresholds to chess.com Game Review counts.

    python scripts/fit_classification.py TRUTH.json RESULTS.jsonl

TRUTH.json maps a game id to chess.com's counts per class as [white, black],
e.g. {"186036623054": {"excellent": [14, 13], "good": [8, 10], ...}}, copied
from the Game Review page. RESULTS.jsonl is the output of
frontend/scripts/calibrate-web.ts for the same games. Only the loss-based
classes are refitted; Best, Great, Brilliant and Book are kept as they are.
The error reported is the total count difference, with leave-one-game-out
cross-validation so it reflects games the fit never saw.
"""

from __future__ import annotations

import itertools
import json
from pathlib import Path

import typer

app = typer.Typer(add_completion=False)
CLASSES = ["excellent", "good", "inaccuracy", "mistake", "miss", "blunder"]
GRID = [(t, mb) for t in itertools.product([0.005, 0.0075, 0.01, 0.0125, 0.015, 0.02],
                                           [0.03, 0.04, 0.05, 0.06],
                                           [0.08, 0.10, 0.12, 0.14],
                                           [0.20, 0.25, 0.30, 0.35, 0.40, 0.50])
        if t[0] < t[1] < t[2] < t[3] for mb in (False, True)]
TODAY = ((0.02, 0.05, 0.10, 0.20), False)


def counts(game: dict, th: tuple[float, ...], miss_blunder: bool) -> dict[str, dict[str, int]]:
    e, g, i, m = th
    out = {c: {k: 0 for k in CLASSES} for c in ("white", "black")}
    prev = None
    for color, ep_best, ep_played, cls in game["moves"]:
        loss = max(0.0, ep_best - ep_played)
        if cls not in ("book", "great", "brilliant", "best"):
            base = ("excellent" if loss <= e else "good" if loss <= g else
                    "inaccuracy" if loss <= i else "mistake" if loss <= m else "blunder")
            missable = ("inaccuracy", "mistake") + (("blunder",) if miss_blunder else ())
            if prev is not None and base in missable and prev >= 0.10 and loss >= 0.10:
                base = "miss"
            out["white" if color == "w" else "black"][base] += 1
        prev = loss
    return out


@app.command()
def main(truth_path: Path = typer.Argument(...), results_path: Path = typer.Argument(...)):
    truth = json.loads(truth_path.read_text(encoding="utf-8"))
    ours = {json.loads(line)["url"].split("/")[-1]: json.loads(line)
            for line in results_path.read_text(encoding="utf-8").splitlines() if line}
    ids = [g for g in truth if g in ours]

    def err(games, th, mb):
        return sum(abs(counts(ours[g], th, mb)[col][k] - truth[g][k][ci])
                   for g in games for ci, col in enumerate(("white", "black")) for k in CLASSES)

    loo_today = loo_new = 0
    for g in ids:
        train = [x for x in ids if x != g]
        best = min(GRID, key=lambda x: err(train, *x))
        loo_today += err([g], *TODAY)
        loo_new += err([g], *best)
    best = min(GRID, key=lambda x: err(ids, *x))
    print(f"{len(ids)} games. Count error on unseen games: old {loo_today}, fitted {loo_new}")
    (e, g, i, m), mb = best
    print(f"Best: excellent {e}  good {g}  inaccuracy {i}  mistake {m}  "
          f"miss_includes_blunder {str(mb).lower()}")
    for name, (th, mb_) in [("chess.com", (None, None)), ("old", TODAY), ("fitted", best)]:
        if name == "chess.com":
            tot = {k: sum(sum(truth[x][k]) for x in ids) for k in CLASSES}
        else:
            tot = {k: sum(counts(ours[x], th, mb_)[c][k] for x in ids for c in ("white", "black"))
                   for k in CLASSES}
        print(f"  {name:<10}" + "  ".join(f"{k} {v}" for k, v in tot.items()))


if __name__ == "__main__":
    app()
