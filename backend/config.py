"""Load and validate config.yaml."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent


class ChessComConfig(BaseModel):
    contact: str = ""
    timeout_seconds: float = 20
    max_retries: int = 5
    backoff_base_seconds: float = 1.0
    backoff_max_seconds: float = 60
    current_month_ttl_seconds: int = 600
    archives_ttl_seconds: int = 3600


class StorageConfig(BaseModel):
    cache_dir: Path = Path(".cache/chesscom")
    reviews_db: Path = Path(".cache/reviews.sqlite3")
    output_dir: Path = Path("output")


class EngineConfig(BaseModel):
    path: str = ""
    depth: int = Field(18, ge=1, le=60)
    threads: int = Field(4, ge=1)
    hash_mb: int = Field(256, ge=16)
    multipv: int = Field(2, ge=1, le=5)
    max_concurrent_jobs: int = Field(1, ge=1)
    max_seconds_per_position: float = Field(0, ge=0)  # 0 = no cap, depth only


class ClassificationConfig(BaseModel):
    excellent: float = 0.02
    good: float = 0.05
    inaccuracy: float = 0.10
    mistake: float = 0.20
    great_gap: float = 0.15
    great_exclude_recaptures: bool = True
    brilliant_max_loss: float = 0.02
    brilliant_min_sacrifice: int = 2
    brilliant_min_ep_after: float = 0.40
    decided_threshold: float = 0.95
    miss_opponent_gain: float = 0.10
    miss_given_back: float = 0.10


class OpeningConfig(BaseModel):
    polyglot_book: str = ""


class AccuracyConfig(BaseModel):
    window_min: int = 2
    window_max: int = 8


DEFAULT_CURVE = [
    (0, 100), (40, 200), (55, 400), (65, 700), (72, 1000), (78, 1300), (83, 1600),
    (87, 1900), (90, 2200), (93, 2500), (96, 2800), (100, 3200),
]


class RatingConfig(BaseModel):
    curve: list[tuple[float, float]] = DEFAULT_CURVE
    full_weight_moves: int = 20


class ReportConfig(BaseModel):
    key_moments: int = 5
    variation_plies: int = 8   # length of engine lines added to the annotated PGN


class ApiConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


class Config(BaseModel):
    chesscom: ChessComConfig = ChessComConfig()
    storage: StorageConfig = StorageConfig()
    engine: EngineConfig = EngineConfig()
    classification: ClassificationConfig = ClassificationConfig()
    opening: OpeningConfig = OpeningConfig()
    accuracy: AccuracyConfig = AccuracyConfig()
    rating: RatingConfig = RatingConfig()
    report: ReportConfig = ReportConfig()
    api: ApiConfig = ApiConfig()

    def resolve_paths(self, base: Path) -> Config:
        s = self.storage
        for name in ("cache_dir", "reviews_db", "output_dir"):
            p = getattr(s, name)
            if not p.is_absolute():
                setattr(s, name, (base / p).resolve())
        e = self.engine
        if e.path and not Path(e.path).is_absolute() and (base / e.path).exists():
            e.path = str((base / e.path).resolve())
        return self


def config_path() -> Path:
    env = os.environ.get("PLYREVIEW_CONFIG")
    if env:
        return Path(env)
    cwd = Path.cwd() / "config.yaml"
    return cwd if cwd.exists() else ROOT / "config.yaml"


ENV_PREFIX = "PLYREVIEW__"


def apply_env_overrides(data: dict, environ: dict[str, str] | None = None) -> dict:
    """PLYREVIEW__ENGINE__PATH=stockfish sets data["engine"]["path"]. Values are YAML."""
    environ = os.environ if environ is None else environ
    for key, raw in environ.items():
        if not key.startswith(ENV_PREFIX):
            continue
        parts = key[len(ENV_PREFIX):].lower().split("__")
        node = data
        for p in parts[:-1]:
            node = node.setdefault(p, {})
        node[parts[-1]] = yaml.safe_load(raw) if raw else raw
    return data


def load_config(path: Path | None = None) -> Config:
    path = path or config_path()
    data = {}
    if path.exists():
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    data = apply_env_overrides(data)
    return Config.model_validate(data).resolve_paths(path.resolve().parent)


@lru_cache(maxsize=1)
def get_config() -> Config:
    return load_config()
