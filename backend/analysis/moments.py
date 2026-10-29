"""Key moments: the moves that swung the game most, plus any brilliant moves."""

from __future__ import annotations

from backend.report.schema import KeyMoment, MoveReview

BAD = {"inaccuracy", "mistake", "miss", "blunder"}


def key_moments(moves: list[MoveReview], white_win: list[float], limit: int = 5,
                min_loss: float = 0.05) -> list[KeyMoment]:
    """Up to `limit` biggest mistakes (by EP lost), plus brilliant moves, in game order."""
    swings = sorted(
        (m for m in moves if m.classification in BAD and m.ep_loss > min_loss),
        key=lambda m: m.ep_loss, reverse=True,
    )[:limit]
    picked = {m.ply for m in swings} | {m.ply for m in moves if m.classification == "brilliant"}

    out = []
    for m in moves:
        if m.ply not in picked:
            continue
        out.append(KeyMoment(
            ply=m.ply,
            move_number=m.move_number,
            color=m.color,
            san=m.san,
            classification=m.classification,
            ep_loss=m.ep_loss,
            white_win_before=white_win[m.ply - 1],
            white_win_after=white_win[m.ply],
            best_san=m.best_san,
            best_line=m.best_pv_san,
        ))
    return out
