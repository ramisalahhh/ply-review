import json
import threading
import time

import pytest
from fastapi.testclient import TestClient
from test_pipeline import PGN, SCRIPT, FakeAnalyzer

from backend.api.main import create_app
from backend.config import Config
from backend.fetch import GameNotFound, UserNotFound
from backend.fetch.models import Game


def make_game(gid: int, end_time: int) -> Game:
    return Game.from_api({
        "url": f"https://www.chess.com/game/live/{gid}", "pgn": PGN, "end_time": end_time,
        "time_control": "600", "time_class": "rapid", "rules": "chess",
        "white": {"username": "ramisalahh", "rating": 400, "result": "win"},
        "black": {"username": "opp", "rating": 410, "result": "checkmated"},
    })


class FakeClient:
    def __init__(self):
        self.games = [make_game(2, 200), make_game(1, 100)]

    def recent_games(self, username, limit=20, refresh=False):
        if username == "nobody":
            raise UserNotFound("nope")
        return self.games[:limit]

    def find_game(self, username, selector):
        if selector.isdigit():
            return self.games[int(selector) - 1]
        for g in self.games:
            if g.url == selector:
                return g
        raise GameNotFound(selector)


class Counting:
    def __init__(self, gate=None):
        self.created = 0
        self.gate = gate

    def __call__(self):
        self.created += 1
        return FakeAnalyzer(SCRIPT, gate=self.gate)


@pytest.fixture
def cfg(tmp_path):
    c = Config()
    c.storage.cache_dir = tmp_path / "cache" / "chesscom"
    c.storage.reviews_db = tmp_path / "reviews.sqlite3"
    return c


@pytest.fixture
def analyzers():
    return Counting()


@pytest.fixture
def api(cfg, analyzers):
    app = create_app(cfg, client=FakeClient(), make_analyzer=analyzers)
    with TestClient(app) as c:
        yield c


def wait_done(api, job_id, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        s = api.get(f"/api/analyses/{job_id}").json()
        if s["status"] in ("done", "error", "cancelled"):
            return s
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def test_health(api):
    assert api.get("/api/health").json()["status"] == "ok"


def test_list_games(api):
    games = api.get("/api/users/ramisalahh/games?limit=5").json()
    assert [g["game_id"] for g in games] == ["live/2", "live/1"]
    g = games[0]
    assert g["my_color"] == "white" and g["outcome"] == "win" and g["opponent"] == "opp"
    assert g["review_id"] is None


def test_unknown_user(api):
    assert api.get("/api/users/nobody/games").status_code == 404


def test_full_flow_and_no_reanalysis(api, analyzers):
    r = api.post("/api/analyses", json={"username": "ramisalahh", "game": "1"})
    assert r.status_code == 202
    job_id, rid = r.json()["job_id"], r.json()["review_id"]
    s = wait_done(api, job_id)
    assert s["status"] == "done" and s["total"] == 8

    review = api.get(f"/api/reviews/{rid}").json()
    assert len(review["moves"]) == 7
    assert "positions" not in review
    assert review["game"]["url"].endswith("/live/2")
    assert "positions" in api.get(f"/api/reviews/{rid}?positions=true").json()

    again = api.post("/api/analyses", json={"username": "ramisalahh",
                                            "game": "https://www.chess.com/game/live/2"}).json()
    assert again == {"job_id": None, "review_id": rid, "status": "done", "done": 0, "total": 0,
                     "error": None}
    assert analyzers.created == 1

    games = api.get("/api/users/ramisalahh/games").json()
    assert games[0]["review_id"] == rid
    assert api.get("/api/reviews?username=ramisalahh").json()[0]["id"] == rid


def test_config_change_reclassifies_without_engine(cfg, analyzers):
    app = create_app(cfg, client=FakeClient(), make_analyzer=analyzers)
    with TestClient(app) as c:
        r = c.post("/api/analyses", json={"username": "ramisalahh", "game": "1"}).json()
        wait_done(c, r["job_id"])
    cfg.classification.mistake = 0.25
    app2 = create_app(cfg, client=FakeClient(), make_analyzer=analyzers)
    with TestClient(app2) as c:
        r2 = c.post("/api/analyses", json={"username": "ramisalahh", "game": "1"}).json()
    assert r2["status"] == "done" and r2["review_id"] != r["review_id"]
    assert analyzers.created == 1


def test_sse_stream(api):
    job = api.post("/api/analyses", json={"username": "ramisalahh", "game": "2"}).json()
    events = []
    with api.stream("GET", f"/api/analyses/{job['job_id']}/events") as resp:
        assert resp.headers["content-type"].startswith("text/event-stream")
        name = None
        for line in resp.iter_lines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                events.append((name, json.loads(line[6:])))
                if name != "progress":
                    break
    progress = [d for n, d in events if n == "progress"]
    assert [d["done"] for d in progress] == list(range(1, 9))
    assert events[-1][0] == "done" and events[-1][1]["review_id"] == job["review_id"]


def test_sse_resume_with_last_event_id(api):
    job = api.post("/api/analyses", json={"username": "ramisalahh", "game": "2"}).json()
    wait_done(api, job["job_id"])
    with api.stream("GET", f"/api/analyses/{job['job_id']}/events",
                    headers={"Last-Event-ID": "5"}) as resp:
        body = resp.read().decode()
    assert body.count("event: progress") == 2  # ids 6 and 7


def test_same_game_twice_shares_job(cfg):
    gate = threading.Event()
    analyzers = Counting(gate)
    app = create_app(cfg, client=FakeClient(), make_analyzer=analyzers)
    with TestClient(app) as c:
        a = c.post("/api/analyses", json={"username": "ramisalahh", "game": "1"}).json()
        b = c.post("/api/analyses", json={"username": "ramisalahh", "game": "1"}).json()
        assert a["job_id"] == b["job_id"]
        gate.set()
        wait_done(c, a["job_id"])
    assert analyzers.created == 1


def test_cancel(cfg):
    gate = threading.Event()
    app = create_app(cfg, client=FakeClient(), make_analyzer=Counting(gate))
    with TestClient(app) as c:
        job = c.post("/api/analyses", json={"username": "ramisalahh", "game": "1"}).json()
        c.delete(f"/api/analyses/{job['job_id']}")
        gate.set()
        assert wait_done(c, job["job_id"])["status"] == "cancelled"
        assert c.get(f"/api/reviews/{job['review_id']}").status_code == 404


def test_pgn_upload(api):
    r = api.post("/api/analyses", json={"pgn": PGN}).json()
    s = wait_done(api, r["job_id"])
    assert s["status"] == "done"
    assert api.get(f"/api/reviews/{r['review_id']}").status_code == 200


def test_bad_requests(api):
    assert api.post("/api/analyses", json={"pgn": "1. e4 e5 2. Ke3"}).status_code == 422
    assert api.post("/api/analyses", json={"pgn": '[Event "x"]\n\n*'}).status_code == 422
    assert api.post("/api/analyses", json={}).status_code == 422
    assert api.post("/api/analyses", json={"username": "ramisalahh",
                                           "game": "https://x.com/game/live/9"}).status_code == 404
    assert api.get("/api/analyses/nope").status_code == 404
    assert api.get("/api/reviews/nope").status_code == 404
