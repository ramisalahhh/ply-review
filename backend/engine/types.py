"""Engine output types, independent of python-chess so they serialise cleanly."""

from __future__ import annotations

from pydantic import BaseModel, model_validator


class Eval(BaseModel):
    """Score from the side to move's point of view.

    Exactly one of cp / mate is set. mate > 0: side to move mates in N.
    mate < 0: side to move gets mated in N. mate == 0: side to move is checkmated.
    """

    cp: int | None = None
    mate: int | None = None

    @model_validator(mode="after")
    def _one_of(self) -> Eval:
        if (self.cp is None) == (self.mate is None):
            raise ValueError("Eval needs exactly one of cp or mate")
        return self

    def flipped(self) -> Eval:
        """Same score from the other side's point of view."""
        if self.mate is not None:
            # side to move checkmated (0) -> other side has delivered mate
            return Eval(mate=-self.mate if self.mate != 0 else 1)
        return Eval(cp=-self.cp)

    def __str__(self) -> str:
        if self.mate is not None:
            return f"#{self.mate}"
        return f"{self.cp / 100:+.2f}"


class Line(BaseModel):
    move: str            # UCI of the first move
    eval: Eval
    pv: list[str] = []   # UCI moves, starting with `move`


class PositionAnalysis(BaseModel):
    fen: str
    depth: int = 0
    lines: list[Line] = []   # best first; empty for terminal positions
    terminal: Eval | None = None  # set when the game is over in this position

    @property
    def best_eval(self) -> Eval:
        if self.terminal is not None:
            return self.terminal
        return self.lines[0].eval
