"""Game model built from chess.com Published-Data API game objects."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel

# chess.com per-player result codes
WIN_CODES = {"win"}
DRAW_CODES = {
    "agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient",
}

Color = Literal["white", "black"]
Outcome = Literal["win", "loss", "draw"]


class Player(BaseModel):
    username: str
    rating: int | None = None
    result: str


class Game(BaseModel):
    url: str
    pgn: str
    end_time: int
    time_control: str
    time_class: str
    rules: str
    rated: bool = True
    white: Player
    black: Player

    @classmethod
    def from_api(cls, raw: dict) -> Game:
        return cls(
            url=raw["url"],
            pgn=raw.get("pgn", ""),
            end_time=raw.get("end_time", 0),
            time_control=raw.get("time_control", ""),
            time_class=raw.get("time_class", ""),
            rules=raw.get("rules", "chess"),
            rated=raw.get("rated", True),
            white=Player(**{k: raw["white"].get(k) for k in ("username", "rating", "result")}),
            black=Player(**{k: raw["black"].get(k) for k in ("username", "rating", "result")}),
        )

    @property
    def game_id(self) -> str:
        return game_id_from_url(self.url) or self.url

    @property
    def date(self) -> datetime:
        return datetime.fromtimestamp(self.end_time, tz=UTC)

    def color_of(self, username: str) -> Color:
        return "white" if self.white.username.lower() == username.lower() else "black"

    def me(self, username: str) -> Player:
        return self.white if self.color_of(username) == "white" else self.black

    def opponent(self, username: str) -> Player:
        return self.black if self.color_of(username) == "white" else self.white

    def outcome_for(self, username: str) -> Outcome:
        code = self.me(username).result
        if code in WIN_CODES:
            return "win"
        if code in DRAW_CODES:
            return "draw"
        return "loss"

    @property
    def result_tag(self) -> str:
        if self.white.result in WIN_CODES:
            return "1-0"
        if self.black.result in WIN_CODES:
            return "0-1"
        return "1/2-1/2"

    @property
    def time_control_label(self) -> str:
        return format_time_control(self.time_control)


def format_time_control(tc: str) -> str:
    """'600' -> '10 min', '180+2' -> '3|2', '1/86400' -> '1 day'."""
    if not tc:
        return "?"
    if "/" in tc:
        secs = int(tc.split("/")[1])
        days = secs // 86400
        return f"{days} day" + ("s" if days != 1 else "") if days else f"{secs // 3600} h"
    base, _, inc = tc.partition("+")
    b = int(base)
    base_label = f"{b // 60}" if b % 60 == 0 else f"{b / 60:g}"
    if inc and inc != "0":
        return f"{base_label}|{inc}"
    return f"{base_label} min"


_ID_RE = re.compile(r"/(live|daily)/(?:game/)?(\d+)|/game/(live|daily)/(\d+)")


def game_id_from_url(url: str) -> str | None:
    """Normalise chess.com game URLs to 'live/123' or 'daily/123'."""
    m = _ID_RE.search(url)
    if not m:
        return None
    kind = m.group(1) or m.group(3)
    gid = m.group(2) or m.group(4)
    return f"{kind}/{gid}"
