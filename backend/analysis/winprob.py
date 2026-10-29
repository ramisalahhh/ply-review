"""Engine evaluation -> expected points (0-1) for the side to move.

Uses the Lichess logistic curve (fitted on real games):
    EP = 1 / (1 + exp(-0.00368208 * cp))
which is Lichess's Win% / 100. Centipawns are clamped to +-1000 first,
as Lichess does; beyond ten pawns the result is decided anyway.

Forced mates map just inside the clamp limits so that a mate is always
worth more than any centipawn score, and a faster mate slightly more than
a slower one.
"""

from __future__ import annotations

import math

from backend.engine.types import Eval

K = 0.00368208
CP_CLAMP = 1000
MATE_BASE = 1.0        # EP of mate-in-1 for the mating side
MATE_STEP = 0.001      # each extra move to mate costs this much
MATE_FLOOR_MOVES = 20  # mates longer than this all score the same


def ep_from_cp(cp: float) -> float:
    cp = max(-CP_CLAMP, min(CP_CLAMP, cp))
    return 1.0 / (1.0 + math.exp(-K * cp))


def _mate_ep(moves: int) -> float:
    return MATE_BASE - MATE_STEP * (min(moves, MATE_FLOOR_MOVES) - 1)


def expected_points(e: Eval) -> float:
    """EP for the side to move."""
    if e.mate is not None:
        if e.mate > 0:
            return _mate_ep(e.mate)
        if e.mate == 0:
            return 0.0
        return 1.0 - _mate_ep(-e.mate)
    return ep_from_cp(e.cp)


def win_percent(e: Eval) -> float:
    """Lichess-style Win% (0-100) for the side to move."""
    return 100.0 * expected_points(e)


def white_ep(e: Eval, white_to_move: bool) -> float:
    """EP from White's point of view (for the eval bar and graph)."""
    ep = expected_points(e)
    return ep if white_to_move else 1.0 - ep
