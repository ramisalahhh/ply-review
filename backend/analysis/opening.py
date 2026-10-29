"""Opening name (ECO) and opening-book detection.

The book is every position reached along any named line in the Lichess
chess-openings data, matched by EPD so transpositions count. An optional
Polyglot book (config `opening.polyglot_book`) extends it.

A move is Book when the position it reaches is in the book, so a move order
that leaves the named lines and transposes back is Book again. Only the first
30 plies are checked.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import chess
import chess.pgn
import chess.polyglot

ECO_DIR = Path(__file__).resolve().parent.parent / "data" / "eco"


@dataclass(frozen=True)
class Opening:
    eco: str
    name: str
    ply: int  # how deep into the game the name was matched


def _epd(board: chess.Board) -> str:
    return board.epd()


@dataclass
class OpeningBook:
    named: dict[str, tuple[str, str]]  # EPD -> (eco, name) for line end positions
    book: set[str]                     # every EPD along a named line
    polyglot: Path | None = None

    def in_book(self, board: chess.Board) -> bool:
        if _epd(board) in self.book:
            return True
        if self.polyglot:
            with chess.polyglot.open_reader(self.polyglot) as r:
                return r.get(board) is not None
        return False

    def name_of(self, board: chess.Board) -> tuple[str, str] | None:
        return self.named.get(_epd(board))


def _read_tsvs(directory: Path):
    for path in sorted(directory.glob("*.tsv")):
        with path.open(encoding="utf-8") as f:
            yield from csv.DictReader(f, delimiter="\t")


@lru_cache(maxsize=4)
def load_book(directory: Path = ECO_DIR, polyglot: str = "") -> OpeningBook:
    named: dict[str, tuple[str, str]] = {}
    book: set[str] = set()
    for row in _read_tsvs(directory):
        game = chess.pgn.read_game(io.StringIO(row["pgn"]))
        if game is None:
            continue
        board = game.board()
        for move in game.mainline_moves():
            board.push(move)
            book.add(_epd(board))
        # Longer (more specific) lines are listed after shorter ones; keep the
        # first name for a position so a transposition does not rename it.
        named.setdefault(_epd(board), (row["eco"], row["name"]))
    pg = Path(polyglot) if polyglot and Path(polyglot).is_file() else None
    return OpeningBook(named=named, book=book, polyglot=pg)


def book_flags(moves: list[chess.Move], book: OpeningBook,
               start: chess.Board | None = None, max_plies: int = 30) -> list[bool]:
    """Per move: does it reach a book position? Transpositions count."""
    board = start.copy() if start else chess.Board()
    flags = []
    for i, m in enumerate(moves):
        board.push(m)
        flags.append(i < max_plies and book.in_book(board))
    return flags


def detect_opening(moves: list[chess.Move], book: OpeningBook,
                   start: chess.Board | None = None, max_plies: int = 40) -> Opening | None:
    """Deepest named position the game passes through."""
    board = start.copy() if start else chess.Board()
    found: Opening | None = None
    for i, m in enumerate(moves[:max_plies], 1):
        board.push(m)
        hit = book.name_of(board)
        if hit:
            found = Opening(eco=hit[0], name=hit[1], ply=i)
    return found
