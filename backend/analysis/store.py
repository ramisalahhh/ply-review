"""Saved engine evaluations, so a game is searched once per engine setting.

(Phase 5 moves finished reviews to SQLite; raw evals stay here.)
"""

from __future__ import annotations

from pathlib import Path

from backend.analysis.pipeline import GameEvaluation
from backend.config import Config


def eval_path(cfg: Config, game_id: str) -> Path:
    e = cfg.engine
    safe = game_id.replace("/", "-")
    return cfg.storage.cache_dir.parent / "evals" / f"{safe}_d{e.depth}_pv{e.multipv}.json"


def load_eval(cfg: Config, game_id: str) -> GameEvaluation | None:
    p = eval_path(cfg, game_id)
    if not p.exists():
        return None
    return GameEvaluation.model_validate_json(p.read_text(encoding="utf-8"))


def save_eval(cfg: Config, game_id: str, ev: GameEvaluation) -> Path:
    p = eval_path(cfg, game_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(ev.model_dump_json(), encoding="utf-8")
    return p
