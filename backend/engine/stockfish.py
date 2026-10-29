"""Stockfish wrapper: analyse one position with MultiPV."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Protocol, Self

import chess
import chess.engine

from backend.config import EngineConfig
from backend.engine.types import Eval, Line, PositionAnalysis


class EngineError(RuntimeError):
    pass


class Analyzer(Protocol):
    def analyse(self, board: chess.Board) -> PositionAnalysis: ...
    def new_game(self) -> None: ...
    def close(self) -> None: ...


def terminal_eval(board: chess.Board) -> Eval | None:
    """Score for a finished position, or None if the game goes on."""
    if board.is_checkmate():
        return Eval(mate=0)
    if (board.is_stalemate() or board.is_insufficient_material()
            or board.is_fifty_moves() or board.is_repetition(3)):
        return Eval(cp=0)
    return None


def to_eval(score: chess.engine.PovScore, turn: chess.Color) -> Eval:
    s = score.pov(turn)
    if s.is_mate():
        return Eval(mate=s.mate())
    return Eval(cp=s.score())


def resolve_engine_path(path: str) -> str:
    if not path:
        raise EngineError("engine.path is empty in config.yaml")
    if Path(path).is_file():
        return path
    found = shutil.which(path)
    if found:
        return found
    raise EngineError(f"Stockfish not found at '{path}'")


class Stockfish:
    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        try:
            self.engine = chess.engine.SimpleEngine.popen_uci(resolve_engine_path(cfg.path))
            self.engine.configure({"Threads": cfg.threads, "Hash": cfg.hash_mb})
        except (OSError, chess.engine.EngineError) as e:
            raise EngineError(f"Could not start Stockfish: {e}") from e
        self.name = self.engine.id.get("name", "Stockfish")
        self._game = object()

    def new_game(self) -> None:
        # python-chess sends ucinewgame (clears the hash) when `game` changes
        self._game = object()

    def analyse(self, board: chess.Board) -> PositionAnalysis:
        fen = board.fen()
        term = terminal_eval(board)
        if term is not None:
            return PositionAnalysis(fen=fen, terminal=term)

        infos = self.engine.analyse(
            board,
            chess.engine.Limit(depth=self.cfg.depth,
                               time=self.cfg.max_seconds_per_position or None),
            multipv=min(self.cfg.multipv, board.legal_moves.count()),
            game=self._game,
        )
        lines = []
        for info in infos:
            pv = info.get("pv") or []
            if not pv or "score" not in info:
                continue
            lines.append(Line(
                move=pv[0].uci(),
                eval=to_eval(info["score"], board.turn),
                pv=[m.uci() for m in pv],
            ))
        if not lines:
            raise EngineError(f"Engine returned no lines for {fen}")
        depth = min(int(i.get("depth", 0)) for i in infos)
        return PositionAnalysis(fen=fen, depth=depth, lines=lines)

    def close(self) -> None:
        try:
            self.engine.quit()
        except chess.engine.EngineTerminatedError:
            pass

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc) -> None:
        self.close()
