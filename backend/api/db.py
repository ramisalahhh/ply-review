"""SQLite store for finished reviews.

A review is keyed by game + engine settings + a hash of the classification
config, so the same game is never analysed twice for the same settings, and
changing thresholds creates a new review (from the saved engine evals, which
is instant) instead of overwriting the old one.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path

from backend.config import Config
from backend.report.schema import SCHEMA_VERSION, Review

SCHEMA = """
CREATE TABLE IF NOT EXISTS reviews (
    id          TEXT PRIMARY KEY,
    game_key    TEXT NOT NULL,
    depth       INTEGER NOT NULL,
    multipv     INTEGER NOT NULL,
    config_hash TEXT NOT NULL,
    username    TEXT,
    white       TEXT,
    black       TEXT,
    date        TEXT,
    url         TEXT,
    created_at  REAL NOT NULL,
    data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_game ON reviews (game_key);
CREATE INDEX IF NOT EXISTS reviews_user ON reviews (username);
"""


def config_hash(cfg: Config) -> str:
    """Hash of everything that changes a review besides the engine search."""
    relevant = {
        "schema": SCHEMA_VERSION,
        "classification": cfg.classification.model_dump(),
        "accuracy": cfg.accuracy.model_dump(),
        "rating": cfg.rating.model_dump(),
        "opening": cfg.opening.model_dump(),
        "report": cfg.report.model_dump(),
    }
    return hashlib.sha1(json.dumps(relevant, sort_keys=True).encode()).hexdigest()[:12]


def review_id(game_key: str, cfg: Config) -> str:
    raw = f"{game_key}|{cfg.engine.depth}|{cfg.engine.multipv}|{config_hash(cfg)}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


class ReviewStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._connect() as con:
            con.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.path, timeout=10)
        con.row_factory = sqlite3.Row
        return con

    def get(self, rid: str) -> Review | None:
        with self._connect() as con:
            row = con.execute("SELECT data FROM reviews WHERE id = ?", (rid,)).fetchone()
        return Review.model_validate_json(row["data"]) if row else None

    def exists(self, rid: str) -> bool:
        with self._connect() as con:
            return con.execute("SELECT 1 FROM reviews WHERE id = ?", (rid,)).fetchone() is not None

    def put(self, rid: str, game_key: str, cfg: Config, review: Review,
            username: str | None = None) -> None:
        with self._lock, self._connect() as con:
            con.execute(
                "INSERT OR REPLACE INTO reviews (id, game_key, depth, multipv, config_hash, "
                "username, white, black, date, url, created_at, data) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (rid, game_key, cfg.engine.depth, cfg.engine.multipv, config_hash(cfg),
                 username.lower() if username else None, review.white.username,
                 review.black.username, review.game.date, review.game.url, time.time(),
                 review.model_dump_json()),
            )

    def list(self, username: str | None = None, limit: int = 50) -> list[dict]:
        q = ("SELECT id, game_key, depth, username, white, black, date, url, created_at "
             "FROM reviews")
        args: tuple = ()
        if username:
            q += " WHERE username = ?"
            args = (username.lower(),)
        q += " ORDER BY created_at DESC LIMIT ?"
        with self._connect() as con:
            return [dict(r) for r in con.execute(q, (*args, limit)).fetchall()]

    def reviewed_keys(self, cfg: Config) -> dict[str, str]:
        """game_key -> review id, for the current settings."""
        with self._connect() as con:
            rows = con.execute(
                "SELECT id, game_key FROM reviews WHERE depth = ? AND multipv = ? "
                "AND config_hash = ?",
                (cfg.engine.depth, cfg.engine.multipv, config_hash(cfg)),
            ).fetchall()
        return {r["game_key"]: r["id"] for r in rows}
