"""Background analysis jobs.

The search itself runs inside the Stockfish process; each job drives it from
its own thread, so callers (the CLI progress bar, the API's SSE stream) stay
responsive. A semaphore caps how many engines run at once.
"""

from __future__ import annotations

import queue
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from backend.analysis.pipeline import GameEvaluation, evaluate_game
from backend.config import EngineConfig
from backend.engine.stockfish import Analyzer, Stockfish

Status = Literal["queued", "running", "done", "error", "cancelled"]


class Cancelled(Exception):
    pass


@dataclass
class ProgressEvent:
    done: int
    total: int
    fen: str
    eval: str


@dataclass
class AnalysisJob:
    pgn: str
    make_analyzer: Callable[[], Analyzer]
    slots: threading.Semaphore
    engine_name: str = "Stockfish"
    depth: int = 0
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: Status = "queued"
    done: int = 0
    total: int = 0
    result: GameEvaluation | None = None
    error: str | None = None
    events: queue.Queue = field(default_factory=queue.Queue)
    history: list[ProgressEvent] = field(default_factory=list)  # for late subscribers (SSE)
    on_done: Callable[[AnalysisJob], None] | None = None  # runs before status becomes "done"
    meta: dict = field(default_factory=dict)
    _cancel: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    def start(self) -> AnalysisJob:
        self._thread = threading.Thread(target=self._run, name=f"analysis-{self.id[:8]}",
                                        daemon=True)
        self._thread.start()
        return self

    @property
    def finished(self) -> bool:
        return self.status in ("done", "error", "cancelled")

    def cancel(self) -> None:
        self._cancel.set()

    def wait(self, timeout: float | None = None) -> None:
        if self._thread:
            self._thread.join(timeout)

    def _progress(self, done: int, total: int, pa) -> None:
        if self._cancel.is_set():
            raise Cancelled()
        self.done, self.total = done, total
        ev = ProgressEvent(done, total, pa.fen, str(pa.best_eval))
        self.history.append(ev)
        self.events.put(ev)

    def _run(self) -> None:
        with self.slots:
            if self._cancel.is_set():
                self.status = "cancelled"
                self.events.put(None)
                return
            self.status = "running"
            analyzer = None
            try:
                analyzer = self.make_analyzer()
                self.engine_name = getattr(analyzer, "name", self.engine_name)
                self.result = evaluate_game(self.pgn, analyzer, self._progress,
                                            self.engine_name, self.depth)
                if self.on_done:
                    self.on_done(self)
                self.status = "done"
            except Cancelled:
                self.status = "cancelled"
            except Exception as e:  # noqa: BLE001 - reported to the caller, not raised in thread
                self.status = "error"
                self.error = str(e)
            finally:
                if analyzer is not None:
                    analyzer.close()
                self.events.put(None)  # end-of-stream marker


class JobRunner:
    def __init__(self, cfg: EngineConfig, max_concurrent: int = 1,
                 make_analyzer: Callable[[], Analyzer] | None = None):
        self.cfg = cfg
        self.slots = threading.Semaphore(max_concurrent)
        self.make_analyzer = make_analyzer or (lambda: Stockfish(cfg))
        self.jobs: dict[str, AnalysisJob] = {}

    def submit(self, pgn: str, engine_name: str = "Stockfish",
               on_done: Callable[[AnalysisJob], None] | None = None,
               meta: dict | None = None) -> AnalysisJob:
        job = AnalysisJob(pgn=pgn, make_analyzer=self.make_analyzer, slots=self.slots,
                          engine_name=engine_name, depth=self.cfg.depth, on_done=on_done,
                          meta=meta or {})
        self.jobs[job.id] = job
        return job.start()
