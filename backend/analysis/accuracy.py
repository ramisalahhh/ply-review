"""Accuracy % per player: the open Lichess formula.

Per move (Win% from the mover's view, before and after the move):
    accuracy = 103.1668 * exp(-0.04354 * (win_before - win_after)) - 3.1669 + 1
clamped to 0-100 (the +1 is Lichess's bonus for imperfect analysis).

Game accuracy per player = average of
  - a volatility-weighted mean: each move is weighted by the standard deviation
    of White's Win% in a sliding window around it (clamped to 0.5-12), so moves
    in sharp positions count more, and
  - a harmonic mean, which punishes a few very bad moves.

Ported from lila (lichess.org) AccuracyPercent.scala.
"""

from __future__ import annotations

import math
import statistics


def move_accuracy(win_before: float, win_after: float) -> float:
    if win_after >= win_before:
        return 100.0
    diff = win_before - win_after
    raw = 103.1668100711649 * math.exp(-0.04354415386753951 * diff) - 3.166924740191411
    return max(0.0, min(100.0, raw + 1))


def _weighted_mean(pairs: list[tuple[float, float]]) -> float:
    total = sum(w for _, w in pairs)
    return sum(v * w for v, w in pairs) / total if total else 0.0


def _harmonic_mean(values: list[float]) -> float:
    return len(values) / sum(1 / max(1.0, v) for v in values) if values else 0.0


def window_weights(white_win: list[float], window_min: int = 2,
                   window_max: int = 8) -> list[float]:
    """One volatility weight per move (len(white_win) - 1 of them)."""
    n = len(white_win)
    size = max(window_min, min(window_max, n // 10))
    size = min(size, n)
    windows = [white_win[:size]] * max(0, size - 2)
    windows += [white_win[i:i + size] for i in range(n - size + 1)]
    weights = []
    for w in windows[: n - 1]:
        sd = statistics.pstdev(w) if len(w) > 1 else 0.0
        weights.append(max(0.5, min(12.0, sd)))
    return weights


def per_move_accuracies(white_win: list[float], white_first: bool = True) -> list[float]:
    """white_win: White's Win% (0-100) for each position, starting position first."""
    out = []
    for i in range(len(white_win) - 1):
        prev, nxt = white_win[i], white_win[i + 1]
        white_moved = (i % 2 == 0) == white_first
        out.append(move_accuracy(prev, nxt) if white_moved
                   else move_accuracy(100 - prev, 100 - nxt))
    return out


def game_accuracy(white_win: list[float], white_first: bool = True, window_min: int = 2,
                  window_max: int = 8) -> dict[str, float | None]:
    accs = per_move_accuracies(white_win, white_first)
    weights = window_weights(white_win, window_min, window_max)
    result: dict[str, float | None] = {}
    for color, parity in (("white", 0 if white_first else 1), ("black", 1 if white_first else 0)):
        idx = [i for i in range(len(accs)) if i % 2 == parity]
        if not idx:
            result[color] = None
            continue
        weighted = _weighted_mean([(accs[i], weights[i]) for i in idx])
        harmonic = _harmonic_mean([accs[i] for i in idx])
        result[color] = (weighted + harmonic) / 2
    return result



def power_mean(xs: list[float], q: float) -> float:
    """q = 1 arithmetic, 0 geometric, -1 harmonic mean (values floored at 1)."""
    xs = [max(x, 1.0) for x in xs]
    if q == 0:
        return math.exp(statistics.mean(math.log(x) for x in xs))
    return statistics.mean(x ** q for x in xs) ** (1 / q)


def fitted_accuracy(losses: list[float], k: float, p: float, q: float, a: float,
                    b: float) -> float | None:
    """Accuracy fitted to chess.com's numbers (see scripts/fit_formula.py).

    losses: expected points lost per move, x 100 (0 = best move).
    """
    if not losses:
        return None
    pm = power_mean([100 * math.exp(-k * (max(0.0, d) ** p)) for d in losses], q)
    return max(0.0, min(100.0, a * pm + b))
