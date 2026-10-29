"""Engine evaluation -> full Review (classes, accuracy, rating, opening).

This step is cheap and needs no engine, so changing thresholds in config.yaml
only needs a re-run of build_review on the saved evaluation.
"""

from __future__ import annotations

import chess

from backend.analysis.accuracy import fitted_accuracy, game_accuracy, per_move_accuracies
from backend.analysis.classify import ORDER, classify_plies
from backend.analysis.moments import key_moments
from backend.analysis.opening import book_flags, detect_opening, load_book
from backend.analysis.pipeline import GameEvaluation, PgnError, parse_pgn
from backend.analysis.rating import estimate_rating
from backend.analysis.winprob import white_ep
from backend.config import Config
from backend.report.schema import (
    GameMeta,
    MoveReview,
    OpeningInfo,
    PlayerSummary,
    Review,
)


def white_win_series(ev: GameEvaluation) -> list[float]:
    out = []
    for pa in ev.positions:
        white_to_move = pa.fen.split()[1] == "w"
        out.append(100.0 * white_ep(pa.best_eval, white_to_move))
    return out


def _int(v: str | None) -> int | None:
    try:
        return int(v) if v else None
    except ValueError:
        return None


def clocks_from_pgn(pgn: str) -> list[float | None]:
    if not pgn:
        return []
    try:
        game = parse_pgn(pgn)
    except PgnError:
        return []
    return [node.clock() for node in game.mainline()]


def build_review(ev: GameEvaluation, cfg: Config, meta: GameMeta | None = None,
                 pgn: str | None = None) -> Review:
    h = ev.headers
    pgn = pgn if pgn is not None else ev.pgn
    start = chess.Board(ev.start_fen)
    moves = [chess.Move.from_uci(p.uci) for p in ev.plies]
    clocks = clocks_from_pgn(pgn)

    book = load_book(polyglot=cfg.opening.polyglot_book)
    in_book = book_flags(moves, book, start)
    opening = detect_opening(moves, book, start)
    classes = classify_plies(ev.plies, in_book, cfg.classification)

    white_win = white_win_series(ev)
    white_first = start.turn == chess.WHITE
    accs = per_move_accuracies(white_win, white_first)
    raw_acc = game_accuracy(white_win, white_first, cfg.accuracy.window_min,
                            cfg.accuracy.window_max)
    acc = dict(raw_acc)
    if (m := cfg.accuracy.model) is not None:
        for color in acc:
            losses = [p.ep_loss * 100 for p, (c, _) in zip(ev.plies, classes, strict=True)
                      if p.color == color and not (m.skip_book and c.value == "book")]
            acc[color] = fitted_accuracy(losses, m.k, m.p, m.q, m.a, m.b)

    reviewed = [
        MoveReview(**p.model_dump(), classification=c.value, accuracy=a, sacrifice=s,
                   clock=clocks[i] if i < len(clocks) else None)
        for i, (p, (c, s), a) in enumerate(zip(ev.plies, classes, accs, strict=True))
    ]

    def summary(color: str) -> PlayerSummary:
        mine = [m for m in reviewed if m.color == color]
        counts = {c.value: 0 for c in ORDER}
        for m in mine:
            counts[m.classification] += 1
        rating = _int(h.get("WhiteElo" if color == "white" else "BlackElo"))
        return PlayerSummary(
            color=color,
            username=h.get("White" if color == "white" else "Black", color),
            rating=rating,
            accuracy=acc[color],
            accuracy_raw=raw_acc[color],
            game_rating=estimate_rating(acc[color], cfg.rating.curve, len(mine), rating,
                                        cfg.rating.full_weight_moves),
            counts=counts,
        )

    meta = meta or GameMeta(
        url=h.get("Link"), date=h.get("Date"), result=h.get("Result", "*"),
        time_control=h.get("TimeControl"), termination=h.get("Termination"),
    )
    return Review(
        game=meta,
        engine=ev.engine,
        depth=ev.depth,
        opening=OpeningInfo(eco=opening.eco, name=opening.name, ply=opening.ply) if opening
        else None,
        book_moves=sum(in_book),
        white=summary("white"),
        black=summary("black"),
        moves=reviewed,
        key_moments=key_moments(reviewed, white_win, cfg.report.key_moments,
                                cfg.classification.good),
        white_win=white_win,
        start_fen=ev.start_fen,
        headers=dict(h),
        pgn=pgn,
        positions=ev.positions,
    )
