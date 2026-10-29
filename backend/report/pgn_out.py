"""Annotated PGN: NAGs, [%eval] and [%clk] comments, and engine lines as variations.

Opens in any chess GUI (Lichess study import, ChessBase, SCID, En Croissant, ...).
"""

from __future__ import annotations

import chess
import chess.engine
import chess.pgn

from backend.analysis.classify import NAG, Cls
from backend.engine.types import Eval
from backend.report.schema import MoveReview, Review

BAD = {Cls.INACCURACY, Cls.MISTAKE, Cls.MISS, Cls.BLUNDER}
LABEL = {
    Cls.BOOK: "Book move.",
    Cls.BRILLIANT: "Brilliant move!",
    Cls.GREAT: "Great move!",
    Cls.BEST: "Best move.",
    Cls.EXCELLENT: "Excellent.",
    Cls.GOOD: "Good.",
    Cls.INACCURACY: "Inaccuracy.",
    Cls.MISTAKE: "Mistake.",
    Cls.MISS: "Missed win.",
    Cls.BLUNDER: "Blunder.",
}


def pov_score(e: Eval) -> chess.engine.PovScore | None:
    """White-POV Eval -> python-chess score; None for a finished (mated) position."""
    if e.mate is not None:
        if e.mate == 0:
            return None
        return chess.engine.PovScore(chess.engine.Mate(e.mate), chess.WHITE)
    return chess.engine.PovScore(chess.engine.Cp(e.cp), chess.WHITE)


def _white(e: Eval, mover_white: bool) -> Eval:
    return e if mover_white else e.flipped()


def move_comment(m: MoveReview) -> str:
    cls = Cls(m.classification)
    text = LABEL[cls]
    if cls in BAD and m.uci != m.best_uci:
        text += f" {m.best_san} was best."
    if cls == Cls.BRILLIANT and m.sacrifice:
        text += f" Gives up {m.sacrifice} point{'s' if m.sacrifice != 1 else ''} of material."
    return text


def build_pgn(review: Review, variation_plies: int = 8) -> chess.pgn.Game:
    game = chess.pgn.Game()
    for k, v in review.headers.items():
        game.headers[k] = v
    start = chess.Board(review.start_fen)
    if review.start_fen != chess.STARTING_FEN:
        game.setup(start)
    if review.opening:
        game.headers["ECO"] = review.opening.eco
        game.headers["Opening"] = review.opening.name
    game.headers["Annotator"] = f"Ply Review ({review.engine}, depth {review.depth})"
    w, b = review.white, review.black

    def acc(p):
        return "-" if p.accuracy is None else f"{p.accuracy:.1f}%"

    game.comment = (f"Accuracy: {w.username} {acc(w)}, {b.username} {acc(b)}. "
                    f"Estimated game rating: {w.game_rating} / {b.game_rating}.")

    node: chess.pgn.GameNode = game
    for m in review.moves:
        parent = node
        mover_white = m.color == "white"
        node = parent.add_variation(chess.Move.from_uci(m.uci))
        cls = Cls(m.classification)
        if cls in NAG:
            node.nags.add(NAG[cls])
        score = pov_score(m.eval_after_white)
        if score is not None and not node.board().is_checkmate():
            node.set_eval(score, depth=review.depth)
        if m.clock is not None:
            node.set_clock(m.clock)
        node.comment = (node.comment + " " + move_comment(m)).strip()

        if cls in BAD and m.uci != m.best_uci:
            pv = review.positions[m.ply - 1].lines[0].pv[:variation_plies]
            var_board = parent.board()
            moves = []
            for u in pv:
                mv = chess.Move.from_uci(u)
                if mv not in var_board.legal_moves:
                    break
                moves.append(mv)
                var_board.push(mv)
            if moves:
                parent.add_line(moves)
                best_score = pov_score(_white(m.best_eval, mover_white))
                if best_score is not None:
                    parent.variations[-1].set_eval(best_score, depth=review.depth)
    game.headers["Result"] = review.game.result or review.headers.get("Result", "*")
    return game


def write_pgn(review: Review, path, variation_plies: int = 8) -> None:
    game = build_pgn(review, variation_plies)
    exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
    path.write_text(game.accept(exporter) + "\n", encoding="utf-8")
