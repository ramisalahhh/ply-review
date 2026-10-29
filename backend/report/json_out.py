"""Review JSON file."""

from __future__ import annotations

from pathlib import Path

from backend.report.schema import Review


def write_json(review: Review, path: Path, include_positions: bool = True) -> None:
    exclude = None if include_positions else {"positions"}
    path.write_text(review.model_dump_json(indent=1, exclude=exclude), encoding="utf-8")


def read_json(path: Path) -> Review:
    return Review.model_validate_json(path.read_text(encoding="utf-8"))
