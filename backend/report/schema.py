"""Review JSON model, shared by the CLI, reports and the API."""

from __future__ import annotations

from pydantic import BaseModel

from backend.analysis.pipeline import PlyEval
from backend.engine.types import PositionAnalysis

SCHEMA_VERSION = 1


class MoveReview(PlyEval):
    classification: str
    accuracy: float          # Lichess per-move accuracy, 0-100
    sacrifice: int = 0       # material given up (pawn = 1)
    clock: float | None = None  # seconds left after the move, from the PGN


class KeyMoment(BaseModel):
    ply: int
    move_number: int
    color: str
    san: str
    classification: str
    ep_loss: float
    white_win_before: float
    white_win_after: float
    best_san: str
    best_line: list[str]


class PlayerSummary(BaseModel):
    color: str
    username: str
    rating: int | None = None
    accuracy: float | None = None
    game_rating: int | None = None
    counts: dict[str, int]


class OpeningInfo(BaseModel):
    eco: str
    name: str
    ply: int


class GameMeta(BaseModel):
    url: str | None = None
    date: str | None = None
    result: str = "*"
    time_control: str | None = None
    termination: str | None = None


class Review(BaseModel):
    schema_version: int = SCHEMA_VERSION
    game: GameMeta
    engine: str
    depth: int
    opening: OpeningInfo | None = None
    book_moves: int = 0
    white: PlayerSummary
    black: PlayerSummary
    moves: list[MoveReview]
    key_moments: list[KeyMoment] = []
    white_win: list[float]   # White's Win% (0-100) per position, for the graph
    start_fen: str
    headers: dict[str, str] = {}
    pgn: str = ""            # original PGN (keeps clock comments)
    positions: list[PositionAnalysis]  # raw engine output, so we can reclassify
