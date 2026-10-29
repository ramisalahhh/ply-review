"""PGN -> engine evaluation of every position and every move.

Each position is searched once (MultiPV). A move's value is taken from the
position before it when the engine already scored that move (line 1 or 2),
otherwise from the position after it, seen from the other side. That halves
the engine work compared with searching every move separately.
"""

from __future__ import annotations

import io
from collections.abc import Callable

import chess
import chess.pgn
from pydantic import BaseModel

from backend.analysis.winprob import expected_points, white_ep
from backend.engine.stockfish import Analyzer
from backend.engine.types import Eval, PositionAnalysis

ProgressFn = Callable[[int, int, PositionAnalysis], None]


class PlyEval(BaseModel):
    ply: int                 # 1-based half-move index
    move_number: int
    color: str               # "white" | "black" (side that moved)
    san: str
    uci: str
    fen_before: str
    fen_after: str
    best_uci: str
    best_san: str
    best_pv_san: list[str]
    best_eval: Eval          # mover's POV
    second_eval: Eval | None  # engine line 2, mover's POV
    played_eval: Eval        # mover's POV
    ep_best: float
    ep_second: float | None
    ep_played: float
    ep_loss: float
    eval_after_white: Eval   # position after the move, White's POV
    white_ep_after: float


class GameEvaluation(BaseModel):
    headers: dict[str, str]
    start_fen: str
    engine: str
    depth: int
    positions: list[PositionAnalysis]
    plies: list[PlyEval]
    pgn: str = ""


class PgnError(ValueError):
    pass


def parse_pgn(pgn: str) -> chess.pgn.Game:
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None or game.errors:
        msg = game.errors[0] if game and game.errors else "empty PGN"
        raise PgnError(f"Could not read PGN: {msg}")
    return game


def _white_pov(e: Eval, white_to_move: bool) -> Eval:
    return e if white_to_move else e.flipped()


def san_line(board: chess.Board, ucis: list[str], limit: int = 10) -> list[str]:
    b = board.copy(stack=False)
    out = []
    for u in ucis[:limit]:
        m = chess.Move.from_uci(u)
        if m not in b.legal_moves:
            break
        out.append(b.san(m))
        b.push(m)
    return out


def evaluate_positions(
    game: chess.pgn.Game,
    analyzer: Analyzer,
    progress: ProgressFn | None = None,
) -> list[PositionAnalysis]:
    board = game.board()
    moves = list(game.mainline_moves())
    total = len(moves) + 1
    analyzer.new_game()
    out = []
    for i in range(total):
        pa = analyzer.analyse(board)
        out.append(pa)
        if progress:
            progress(i + 1, total, pa)
        if i < len(moves):
            board.push(moves[i])
    return out


def build_plies(game: chess.pgn.Game, positions: list[PositionAnalysis]) -> list[PlyEval]:
    board = game.board()
    plies = []
    for i, move in enumerate(game.mainline_moves()):
        before, after = positions[i], positions[i + 1]
        mover_white = board.turn == chess.WHITE
        uci = move.uci()
        best = before.lines[0]
        second = before.lines[1] if len(before.lines) > 1 else None

        if uci == best.move:
            played = best.eval
        elif second is not None and uci == second.move:
            played = second.eval
        else:
            played = after.best_eval.flipped()

        ep_best = expected_points(best.eval)
        ep_played = expected_points(played)
        san = board.san(move)
        fen_before = board.fen()
        best_pv_san = san_line(board, best.pv)
        move_number = board.fullmove_number
        board.push(move)

        after_white = _white_pov(after.best_eval, not mover_white)
        plies.append(PlyEval(
            ply=i + 1,
            move_number=move_number,
            color="white" if mover_white else "black",
            san=san,
            uci=uci,
            fen_before=fen_before,
            fen_after=board.fen(),
            best_uci=best.move,
            best_san=best_pv_san[0] if best_pv_san else best.move,
            best_pv_san=best_pv_san,
            best_eval=best.eval,
            second_eval=second.eval if second else None,
            played_eval=played,
            ep_best=ep_best,
            ep_second=expected_points(second.eval) if second else None,
            ep_played=ep_played,
            ep_loss=max(0.0, ep_best - ep_played),
            eval_after_white=after_white,
            white_ep_after=white_ep(after.best_eval, not mover_white),
        ))
    return plies


def evaluate_game(
    pgn: str,
    analyzer: Analyzer,
    progress: ProgressFn | None = None,
    engine_name: str = "Stockfish",
    depth: int = 0,
) -> GameEvaluation:
    game = parse_pgn(pgn)
    positions = evaluate_positions(game, analyzer, progress)
    return GameEvaluation(
        headers=dict(game.headers),
        start_fen=game.board().fen(),
        engine=engine_name,
        depth=depth,
        positions=positions,
        plies=build_plies(game, positions),
        pgn=pgn,
    )
