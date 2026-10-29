"""Estimated game rating from accuracy.

chess.com does not publish how it estimates a game rating, so this is a plain
piecewise-linear curve from accuracy to rating (config `rating.curve`).
Very short games are pulled toward the player's real rating because a handful
of moves says little. scripts/calibrate.py can refit the curve to your games.
"""

from __future__ import annotations

import itertools


def interpolate(curve: list[tuple[float, float]], x: float) -> float:
    pts = sorted(curve)
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in itertools.pairwise(pts):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def estimate_rating(
    accuracy: float | None,
    curve: list[tuple[float, float]],
    moves: int,
    player_rating: int | None = None,
    full_weight_moves: int = 20,
) -> int | None:
    if accuracy is None:
        return None
    est = interpolate(curve, accuracy)
    if player_rating and moves < full_weight_moves:
        w = moves / full_weight_moves
        est = w * est + (1 - w) * player_rating
    return round(est / 50) * 50
