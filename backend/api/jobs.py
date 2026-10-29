"""Analysis service: start jobs, reuse stored reviews and saved evals."""

from __future__ import annotations

import hashlib
import threading
from collections.abc import Callable
from dataclasses import dataclass

from backend.analysis.pipeline import GameEvaluation, parse_pgn
from backend.analysis.review import build_review
from backend.analysis.store import load_eval, save_eval
from backend.api.db import ReviewStore, review_id
from backend.config import Config
from backend.engine.stockfish import Analyzer
from backend.engine.worker import AnalysisJob, JobRunner
from backend.fetch import ChessComClient, Game
from backend.report.schema import GameMeta


@dataclass
class StartResult:
    status: str               # "done" | "queued" | "running"
    review_id: str
    job_id: str | None = None


def meta_for(g: Game) -> GameMeta:
    return GameMeta(url=g.url, date=g.date.strftime("%Y-%m-%d"), result=g.result_tag,
                    time_control=g.time_control_label)


class AnalysisService:
    def __init__(self, cfg: Config, store: ReviewStore, client: ChessComClient,
                 make_analyzer: Callable[[], Analyzer] | None = None):
        self.cfg = cfg
        self.store = store
        self.client = client
        self.client_lock = threading.Lock()  # chess.com asks for one request at a time
        self.runner = JobRunner(cfg.engine, cfg.engine.max_concurrent_jobs, make_analyzer)
        self.active: dict[str, AnalysisJob] = {}
        self._lock = threading.Lock()

    # -- chess.com --------------------------------------------------------------

    def recent_games(self, username: str, limit: int, refresh: bool = False) -> list[Game]:
        with self.client_lock:
            return self.client.recent_games(username, limit=limit, refresh=refresh)

    def find_game(self, username: str, selector: str) -> Game:
        with self.client_lock:
            return self.client.find_game(username, selector)

    # -- analysis ---------------------------------------------------------------

    def _store_review(self, key: str, ev: GameEvaluation, meta: GameMeta | None,
                      username: str | None, pgn: str) -> str:
        rid = review_id(key, self.cfg)
        review = build_review(ev, self.cfg, meta, pgn=pgn)
        self.store.put(rid, key, self.cfg, review, username)
        return rid

    def start(self, *, username: str | None = None, game: str | None = None,
              pgn: str | None = None) -> StartResult:
        meta: GameMeta | None = None
        if pgn:
            if parse_pgn(pgn).next() is None:  # validate early
                raise ValueError("The PGN has no moves")
            key = "pgn/" + hashlib.sha1(pgn.strip().encode()).hexdigest()[:16]
        else:
            if not username or not game:
                raise ValueError("Give either a PGN, or a username and a game index/URL")
            g = self.find_game(username, game)
            key, pgn, meta = g.game_id, g.pgn, meta_for(g)

        rid = review_id(key, self.cfg)
        if self.store.exists(rid):
            return StartResult("done", rid)
        saved = load_eval(self.cfg, key)
        if saved is not None:  # engine already ran (CLI or earlier settings): just reclassify
            return StartResult("done", self._store_review(key, saved, meta, username, pgn))

        with self._lock:
            job = self.active.get(key)
            if job is not None and not job.finished:
                return StartResult(job.status, rid, job.id)

            def finish(j: AnalysisJob) -> None:
                save_eval(self.cfg, key, j.result)
                self._store_review(key, j.result, meta, username, pgn)

            job = self.runner.submit(pgn, on_done=finish, meta={"review_id": rid, "key": key})
            self.active[key] = job
        return StartResult(job.status, rid, job.id)

    def job(self, job_id: str) -> AnalysisJob | None:
        return self.runner.jobs.get(job_id)
