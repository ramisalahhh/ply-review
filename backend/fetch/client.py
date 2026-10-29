"""Client for the chess.com Published-Data API (https://api.chess.com/pub/...).

Requests are made one at a time, as chess.com asks. 429 and 5xx responses are
retried with exponential backoff (Retry-After wins when present). Responses are
cached on disk; past monthly archives never change, so they are never refetched.
"""

from __future__ import annotations

import random
import re
import time
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Self

import httpx

from backend.config import Config, get_config
from backend.fetch.cache import CacheEntry, JsonCache
from backend.fetch.models import Game, game_id_from_url

API = "https://api.chess.com/pub"
VERSION = "0.1.0"
RETRY_STATUSES = {429, 500, 502, 503, 504}
_ARCHIVE_RE = re.compile(r"/games/(\d{4})/(\d{2})$")


class ChessComError(RuntimeError):
    pass


class UserNotFound(ChessComError):
    pass


class GameNotFound(ChessComError):
    pass


def user_agent(contact: str) -> str:
    ua = f"PlyReview/{VERSION} (personal game review tool; python-httpx)"
    return f"{ua} contact: {contact}" if contact else ua


class ChessComClient:
    def __init__(
        self,
        config: Config | None = None,
        http: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        offline: bool = False,
    ):
        self.cfg = config or get_config()
        c = self.cfg.chesscom
        self.http = http or httpx.Client(
            timeout=c.timeout_seconds,
            headers={"User-Agent": user_agent(c.contact), "Accept": "application/json"},
            follow_redirects=True,
        )
        self.cache = JsonCache(self.cfg.storage.cache_dir)
        self.sleep = sleep
        self.offline = offline

    def close(self) -> None:
        self.http.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- HTTP ---------------------------------------------------------------

    def _backoff(self, attempt: int, resp: httpx.Response | None) -> float:
        c = self.cfg.chesscom
        if resp is not None:
            ra = resp.headers.get("Retry-After")
            if ra:
                try:
                    return min(float(ra), c.backoff_max_seconds)
                except ValueError:
                    pass
        delay = c.backoff_base_seconds * (2**attempt)
        return min(delay + random.uniform(0, c.backoff_base_seconds), c.backoff_max_seconds)

    def _request(self, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
        retries = self.cfg.chesscom.max_retries
        for attempt in range(retries + 1):
            resp: httpx.Response | None = None
            try:
                resp = self.http.get(url, headers=headers)
            except httpx.TransportError as e:
                if attempt == retries:
                    raise ChessComError(f"Network error for {url}: {e}") from e
            else:
                if resp.status_code not in RETRY_STATUSES:
                    return resp
                if attempt == retries:
                    raise ChessComError(
                        f"HTTP {resp.status_code} for {url} after {retries} retries")
            self.sleep(self._backoff(attempt, resp))
        raise AssertionError("unreachable")

    def _get_json(self, url: str, key: str, ttl: float | None):
        """Fetch JSON with cache. ttl=None means cached forever."""
        cached = self.cache.get(key)
        if cached and (self.offline or ttl is None or cached.age() < ttl):
            return cached.data
        if self.offline:
            raise ChessComError(f"Offline and nothing cached for {key}")

        headers = {}
        if cached:
            if cached.etag:
                headers["If-None-Match"] = cached.etag
            if cached.last_modified:
                headers["If-Modified-Since"] = cached.last_modified
        resp = self._request(url, headers)

        if resp.status_code == 304 and cached:
            self.cache.touch(key, cached)
            return cached.data
        if resp.status_code == 404:
            raise UserNotFound(f"Not found: {url}")
        if resp.status_code >= 400:
            raise ChessComError(f"HTTP {resp.status_code} for {url}")

        data = resp.json()
        self.cache.put(
            key,
            CacheEntry(
                data=data,
                fetched_at=time.time(),
                etag=resp.headers.get("ETag"),
                last_modified=resp.headers.get("Last-Modified"),
            ),
        )
        return data

    # -- API ----------------------------------------------------------------

    def archives(self, username: str, refresh: bool = False) -> list[str]:
        u = username.lower()
        ttl = 0 if refresh else self.cfg.chesscom.archives_ttl_seconds
        data = self._get_json(f"{API}/player/{u}/games/archives", f"{u}/archives", ttl)
        return data.get("archives", [])

    def month_games(self, archive_url: str, refresh: bool = False) -> list[Game]:
        return [Game.from_api(g) for g in self.month_raw(archive_url, refresh)]

    def month_raw(self, archive_url: str, refresh: bool = False) -> list[dict]:
        """The month's game objects exactly as chess.com sends them (incl. `accuracies`)."""
        m = _ARCHIVE_RE.search(archive_url)
        if not m:
            raise ChessComError(f"Unexpected archive URL: {archive_url}")
        year, month = int(m.group(1)), int(m.group(2))
        user = archive_url.split("/player/")[1].split("/")[0].lower()
        now = datetime.now(UTC)
        is_current = (year, month) >= (now.year, now.month)
        ttl: float | None
        if refresh:
            ttl = 0
        elif is_current:
            ttl = self.cfg.chesscom.current_month_ttl_seconds
        else:
            ttl = None
        data = self._get_json(archive_url, f"{user}/{year:04d}-{month:02d}", ttl)
        return data.get("games", [])

    def iter_games(self, username: str, refresh: bool = False) -> Iterator[Game]:
        """Standard-chess games, newest first."""
        for url in reversed(self.archives(username, refresh=refresh)):
            games = self.month_games(url, refresh=refresh)
            for g in sorted(games, key=lambda g: g.end_time, reverse=True):
                if g.rules == "chess" and g.pgn:
                    yield g

    def recent_games(self, username: str, limit: int = 20, refresh: bool = False) -> list[Game]:
        out: list[Game] = []
        for g in self.iter_games(username, refresh=refresh):
            out.append(g)
            if len(out) >= limit:
                break
        return out

    def find_game(self, username: str, selector: str, max_months: int = 24) -> Game:
        """Find a game by 1-based index (1 = most recent) or by chess.com game URL."""
        if selector.isdigit():
            idx = int(selector)
            if idx < 1:
                raise GameNotFound("Index starts at 1")
            games = self.recent_games(username, limit=idx)
            if len(games) < idx:
                raise GameNotFound(f"Only {len(games)} games found for {username}")
            return games[idx - 1]

        want = game_id_from_url(selector)
        if not want:
            raise GameNotFound(f"Not a chess.com game URL: {selector}")
        for i, url in enumerate(reversed(self.archives(username))):
            if i >= max_months:
                break
            for g in self.month_games(url):
                if g.game_id == want:
                    return g
        raise GameNotFound(f"Game {want} not found in the last {max_months} months of {username}")
