"""Local JSON cache for chess.com API responses."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class CacheEntry:
    data: Any
    fetched_at: float
    etag: str | None = None
    last_modified: str | None = None

    def age(self) -> float:
        return time.time() - self.fetched_at


class JsonCache:
    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        safe = key.strip("/").replace("..", "_")
        return self.root / f"{safe}.json"

    def get(self, key: str) -> CacheEntry | None:
        p = self._path(key)
        if not p.exists():
            return None
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            return CacheEntry(**raw)
        except (json.JSONDecodeError, TypeError):
            return None

    def put(self, key: str, entry: CacheEntry) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(entry.__dict__), encoding="utf-8")
        tmp.replace(p)

    def touch(self, key: str, entry: CacheEntry) -> None:
        entry.fetched_at = time.time()
        self.put(key, entry)
