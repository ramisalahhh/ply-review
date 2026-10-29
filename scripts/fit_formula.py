"""Search for an accuracy formula that tracks chess.com's numbers.

    python scripts/fit_formula.py [calibration/results-web.jsonl] [--write]

Uses the per-move data saved by frontend/scripts/calibrate-web.ts. The model:

    move score  s = 100 * exp(-k * loss^p)        loss = expected points lost x 100
    player      A = a * PowerMean_q(s) + b          (book moves optionally left out)

PowerMean_q is the arithmetic mean at q = 1, the geometric mean at q = 0, and
the harmonic mean at q = -1. a and b are a final straight-line fit.
Parameters are chosen by 5-fold cross-validation over games, so the reported
error is what to expect on games the fit never saw. --write saves the result
under `accuracy.model` in config.yaml.
"""

from __future__ import annotations

import json
import math
import random
import re
import statistics
import sys
from pathlib import Path

import typer

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.analysis.accuracy import game_accuracy, power_mean  # noqa: E402

app = typer.Typer(add_completion=False)
KS = [0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10]
PS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
QS = [-1.0, -0.5, 0.0, 0.5, 1.0]
BOOK = [True, False]  # exclude book moves?


def player_moves(game: dict, color: str, skip_book: bool) -> list[float]:
    losses = [max(0.0, (eb - ep) * 100) for c, eb, ep, cls in game["moves"]
              if c == color[0] and not (skip_book and cls == "book")]
    return losses


def score(losses: list[float], k: float, p: float, q: float) -> float | None:
    if not losses:
        return None
    return power_mean([100 * math.exp(-k * (d ** p)) for d in losses], q)


def affine(xs: list[float], ys: list[float]) -> tuple[float, float]:
    mx, my = statistics.mean(xs), statistics.mean(ys)
    vx = sum((x - mx) ** 2 for x in xs)
    a = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / vx if vx else 1.0
    return a, my - a * mx


@app.command()
def main(path: Path = typer.Argument(Path("calibration/results-web.jsonl")),
         write: bool = typer.Option(False, help="Save the best model to config.yaml"),
         min_plies: int = typer.Option(0, help="Ignore games shorter than this")):
    games = [json.loads(line) for line in (ROOT / path).read_text(encoding="utf-8").splitlines()
             if line]
    games = [g for g in games if "moves" in g and g["plies"] >= min_plies]
    items = [(gi, color) for gi, g in enumerate(games) for color in ("white", "black")]
    truth = [games[gi][f"api_{c}"] for gi, c in items]
    print(f"{len(games)} games, {len(items)} accuracy values")

    # baseline: the Lichess formula we use today (raw, no correction)
    lich = [game_accuracy(games[gi]["white_win"])[c] for gi, c in items]
    base = [abs(x - y) for x, y in zip(lich, truth, strict=True) if x is not None]
    print(f"Lichess formula (today):  MAE {statistics.mean(base):.1f}")

    # every candidate's raw prediction for every item
    combos, preds = [], []
    for skip in BOOK:
        moves = [player_moves(games[gi], c, skip) for gi, c in items]
        for k in KS:
            for p in PS:
                scored = [[100 * math.exp(-k * (d ** p)) for d in ls] for ls in moves]
                for q in QS:
                    combos.append((k, p, q, skip))
                    preds.append([power_mean(s, q) if s else 100.0 for s in scored])

    folds = list(range(len(games)))
    random.Random(7).shuffle(folds)
    fold_of = {g: i % 5 for i, g in enumerate(folds)}
    cv_err: list[float] = []
    for f in range(5):
        train = [i for i, (gi, _) in enumerate(items) if fold_of[gi] != f]
        test = [i for i, (gi, _) in enumerate(items) if fold_of[gi] == f]
        best = None
        for ci, pr in enumerate(preds):
            a, b = affine([pr[i] for i in train], [truth[i] for i in train])
            mae = statistics.mean(abs(a * pr[i] + b - truth[i]) for i in train)
            if best is None or mae < best[0]:
                best = (mae, ci, a, b)
        _, ci, a, b = best
        cv_err += [a * preds[ci][i] + b - truth[i] for i in test]
    cv_mae = statistics.mean(map(abs, cv_err))
    within3 = sum(abs(e) <= 3 for e in cv_err) / len(cv_err)
    within5 = sum(abs(e) <= 5 for e in cv_err) / len(cv_err)
    print(f"Fitted formula (tested on unseen games): MAE {cv_mae:.1f}, "
          f"within ±3: {within3:.0%}, within ±5: {within5:.0%}")

    # final model on all games
    best = None
    for ci, pr in enumerate(preds):
        a, b = affine(pr, truth)
        mae = statistics.mean(abs(a * x + b - y) for x, y in zip(pr, truth, strict=True))
        if best is None or mae < best[0]:
            best = (mae, ci, a, b)
    mae, ci, a, b = best
    k, p, q, skip = combos[ci]
    print(f"\nBest model: k={k} p={p} q={q} skip_book={skip}  a={a:.4f} b={b:.3f}  "
          f"(fit MAE {mae:.1f})")
    errs = [a * x + b - y for x, y in zip(preds[ci], truth, strict=True)]
    for lo, hi in [(0, 800), (800, 1300), (1300, 1800), (1800, 2300), (2300, 4000)]:
        d = [e for (gi, _), e in zip(items, errs, strict=True)
             if lo <= (games[gi]["white_rating"] + games[gi]["black_rating"]) / 2 < hi]
        if d:
            print(f"  {lo:>4}-{hi:<4} n={len(d):>3}  bias {statistics.mean(d):+5.1f}  "
                  f"MAE {statistics.mean(map(abs, d)):4.1f}")
    for label, cond in [("short (<60 plies)", lambda g: g["plies"] < 60),
                        ("long (>=60 plies)", lambda g: g["plies"] >= 60)]:
        d = [e for (gi, _), e in zip(items, errs, strict=True) if cond(games[gi])]
        if d:
            print(f"  {label:<18} n={len(d):>3}  MAE {statistics.mean(map(abs, d)):4.1f}")

    if write:
        cfg = ROOT / "config.yaml"
        text = cfg.read_text(encoding="utf-8")
        block = (f"  model:   # fitted by scripts/fit_formula.py (CV MAE {cv_mae:.1f})\n"
                 f"    k: {k}\n    p: {p}\n    q: {q}\n    skip_book: {str(skip).lower()}\n"
                 f"    a: {a:.5f}\n    b: {b:.4f}\n")
        text = re.sub(r"  model:.*?\n(?:    \w+: .*\n)*", "", text)
        text = text.replace("  window_max: 8\n", "  window_max: 8\n" + block, 1)
        cfg.write_text(text, encoding="utf-8")
        print("Saved to config.yaml (run scripts/export_web_data.py to update the website).")


if __name__ == "__main__":
    app()
