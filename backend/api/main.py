"""FastAPI app.

Run with:  review serve      (or)  uvicorn backend.api.main:create_app --factory
Interactive docs at /docs.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.analysis.pipeline import PgnError
from backend.api.db import ReviewStore
from backend.api.jobs import AnalysisService
from backend.config import Config, get_config
from backend.engine.stockfish import Analyzer, EngineError, resolve_engine_path
from backend.engine.worker import AnalysisJob
from backend.fetch import ChessComClient, ChessComError, GameNotFound, UserNotFound


class GameSummary(BaseModel):
    index: int
    url: str
    game_id: str
    date: str
    time_control: str
    time_class: str
    rated: bool
    white: str
    white_rating: int | None
    black: str
    black_rating: int | None
    result: str
    my_color: str
    outcome: str
    opponent: str
    opponent_rating: int | None
    review_id: str | None = None


class StartAnalysis(BaseModel):
    username: str | None = None
    game: str | None = None   # index from the games list (1 = newest) or a chess.com game URL
    pgn: str | None = None


class AnalysisStatus(BaseModel):
    job_id: str | None
    review_id: str
    status: str
    done: int = 0
    total: int = 0
    error: str | None = None


def _status(job: AnalysisJob) -> AnalysisStatus:
    return AnalysisStatus(job_id=job.id, review_id=job.meta.get("review_id", ""),
                          status=job.status, done=job.done, total=job.total, error=job.error)


def _sse(event: str, data: dict, event_id: int | None = None) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {event}\ndata: {json.dumps(data)}\n\n"


def create_app(cfg: Config | None = None, client: ChessComClient | None = None,
               make_analyzer: Callable[[], Analyzer] | None = None) -> FastAPI:
    cfg = cfg or get_config()
    store = ReviewStore(cfg.storage.reviews_db)
    service = AnalysisService(cfg, store, client or ChessComClient(cfg), make_analyzer)

    app = FastAPI(title="Ply Review API", version="0.1.0")
    app.state.service = service
    app.add_middleware(CORSMiddleware, allow_origins=cfg.api.cors_origins,
                       allow_methods=["*"], allow_headers=["*"])

    @app.get("/api/health")
    def health():
        try:
            engine = resolve_engine_path(cfg.engine.path)
        except EngineError as e:
            engine = None
            engine_error = str(e)
        else:
            engine_error = None
        return {"status": "ok", "engine": engine, "engine_error": engine_error,
                "depth": cfg.engine.depth, "multipv": cfg.engine.multipv}

    @app.get("/api/users/{username}/games", response_model=list[GameSummary])
    def list_games(username: str, limit: int = Query(20, ge=1, le=200), refresh: bool = False):
        try:
            games = service.recent_games(username, limit, refresh)
        except UserNotFound:
            raise HTTPException(404, f"chess.com user '{username}' not found") from None
        except ChessComError as e:
            raise HTTPException(502, str(e)) from e
        reviewed = store.reviewed_keys(cfg)
        out = []
        for i, g in enumerate(games, 1):
            opp = g.opponent(username)
            out.append(GameSummary(
                index=i, url=g.url, game_id=g.game_id, date=g.date.isoformat(),
                time_control=g.time_control_label, time_class=g.time_class, rated=g.rated,
                white=g.white.username, white_rating=g.white.rating,
                black=g.black.username, black_rating=g.black.rating,
                result=g.result_tag, my_color=g.color_of(username),
                outcome=g.outcome_for(username), opponent=opp.username,
                opponent_rating=opp.rating, review_id=reviewed.get(g.game_id),
            ))
        return out

    @app.post("/api/analyses", response_model=AnalysisStatus, status_code=202)
    def start_analysis(body: StartAnalysis):
        try:
            r = service.start(username=body.username, game=body.game, pgn=body.pgn)
        except (GameNotFound, UserNotFound) as e:
            raise HTTPException(404, str(e)) from e
        except ChessComError as e:
            raise HTTPException(502, str(e)) from e
        except (ValueError, PgnError) as e:
            raise HTTPException(422, str(e)) from e
        job = service.job(r.job_id) if r.job_id else None
        if job is not None:
            return _status(job)
        return AnalysisStatus(job_id=None, review_id=r.review_id, status=r.status)

    def _job_or_404(job_id: str) -> AnalysisJob:
        job = service.job(job_id)
        if job is None:
            raise HTTPException(404, "No such analysis job")
        return job

    @app.get("/api/analyses/{job_id}", response_model=AnalysisStatus)
    def analysis_status(job_id: str):
        return _status(_job_or_404(job_id))

    @app.delete("/api/analyses/{job_id}", response_model=AnalysisStatus)
    def cancel_analysis(job_id: str):
        job = _job_or_404(job_id)
        job.cancel()
        return _status(job)

    @app.get("/api/analyses/{job_id}/events")
    async def analysis_events(job_id: str, last_event_id: str | None = Header(None)):
        """Server-Sent Events: `progress` per position, then `done` / `error` / `cancelled`."""
        job = _job_or_404(job_id)
        start = int(last_event_id) + 1 if last_event_id and last_event_id.isdigit() else 0

        async def stream() -> AsyncIterator[str]:
            idx = start
            yield "retry: 2000\n\n"
            while True:
                hist = job.history
                while idx < len(hist):
                    ev = hist[idx]
                    yield _sse("progress", {"done": ev.done, "total": ev.total, "fen": ev.fen,
                                            "eval": ev.eval}, idx)
                    idx += 1
                if job.finished:
                    yield _sse(job.status, _status(job).model_dump())
                    return
                await asyncio.sleep(0.2)

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache",
                                          "X-Accel-Buffering": "no"})

    @app.get("/api/reviews")
    def list_reviews(username: str | None = None, limit: int = Query(50, ge=1, le=500)):
        return store.list(username, limit)

    @app.get("/api/reviews/{rid}")
    def get_review(rid: str, positions: bool = False):
        review = store.get(rid)
        if review is None:
            raise HTTPException(404, "Review not found")
        return review.model_dump(mode="json", exclude=None if positions else {"positions"})

    return app
