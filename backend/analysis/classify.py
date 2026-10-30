"""Move classification. Every threshold comes from config.classification.

Checked in this order (first match wins):
  Book       reaches an opening-book position (transpositions count)
  Brilliant  best or near-best AND gives up material, position not already
             completely winning, and not bad for the mover afterwards
  Great      the engine's top move and the only good one: big EP gap between
             engine line 1 and line 2 (obvious recaptures excluded)
  Miss       the opponent's last move handed me a chance and I gave most of it
             back without blundering
  Best       the engine's top move
  Excellent / Good / Inaccuracy / Mistake / Blunder  by expected points lost
"""

from __future__ import annotations

from enum import StrEnum

import chess

from backend.analysis.material import sacrifice_amount
from backend.analysis.pipeline import PlyEval
from backend.config import ClassificationConfig


class Cls(StrEnum):
    BOOK = "book"
    BRILLIANT = "brilliant"
    GREAT = "great"
    BEST = "best"
    EXCELLENT = "excellent"
    GOOD = "good"
    INACCURACY = "inaccuracy"
    MISTAKE = "mistake"
    MISS = "miss"
    BLUNDER = "blunder"


ORDER = [Cls.BRILLIANT, Cls.GREAT, Cls.BEST, Cls.EXCELLENT, Cls.GOOD, Cls.BOOK,
         Cls.INACCURACY, Cls.MISTAKE, Cls.MISS, Cls.BLUNDER]

NAG = {
    Cls.BRILLIANT: 3,   # !!
    Cls.GREAT: 1,       # !
    Cls.INACCURACY: 6,  # ?!
    Cls.MISTAKE: 2,     # ?
    Cls.MISS: 2,        # ?
    Cls.BLUNDER: 4,     # ??
}


def by_loss(loss: float, c: ClassificationConfig) -> Cls:
    if loss <= c.excellent:
        return Cls.EXCELLENT
    if loss <= c.good:
        return Cls.GOOD
    if loss <= c.inaccuracy:
        return Cls.INACCURACY
    if loss <= c.mistake:
        return Cls.MISTAKE
    return Cls.BLUNDER


def is_recapture(prev: PlyEval | None, p: PlyEval, board: chess.Board) -> bool:
    if prev is None:
        return False
    move = chess.Move.from_uci(p.uci)
    prev_move = chess.Move.from_uci(prev.uci)
    return board.is_capture(move) and move.to_square == prev_move.to_square and (
        prev.san.find("x") >= 0)


def classify_move(
    p: PlyEval,
    prev: PlyEval | None,
    in_book: bool,
    c: ClassificationConfig,
) -> tuple[Cls, int]:
    """Return (classification, material sacrificed)."""
    if in_book:
        return Cls.BOOK, 0

    board = chess.Board(p.fen_before)
    move = chess.Move.from_uci(p.uci)
    forced = board.legal_moves.count() == 1
    is_best = p.uci == p.best_uci
    base = Cls.BEST if is_best else by_loss(p.ep_loss, c)
    if forced:
        return Cls.BEST, 0

    sac = sacrifice_amount(board, move)
    if (sac >= c.brilliant_min_sacrifice
            and p.ep_loss <= c.brilliant_max_loss
            and p.ep_best < c.decided_threshold
            and p.ep_played >= c.brilliant_min_ep_after):
        return Cls.BRILLIANT, sac

    if (is_best and p.ep_second is not None
            and p.ep_best - p.ep_second >= c.great_gap
            and p.ep_second < c.decided_threshold
            and p.ep_best > 1 - c.decided_threshold
            and not (c.great_exclude_recaptures and is_recapture(prev, p, board))):
        return Cls.GREAT, sac

    missable = (Cls.INACCURACY, Cls.MISTAKE) + ((Cls.BLUNDER,) if c.miss_includes_blunder else ())
    if (prev is not None and base in missable
            and prev.ep_loss >= c.miss_opponent_gain
            and p.ep_loss >= c.miss_given_back):
        return Cls.MISS, sac

    return base, sac


def classify_plies(
    plies: list[PlyEval], in_book: list[bool], c: ClassificationConfig,
) -> list[tuple[Cls, int]]:
    out = []
    for i, p in enumerate(plies):
        prev = plies[i - 1] if i > 0 else None
        out.append(classify_move(p, prev, in_book[i], c))
    return out
