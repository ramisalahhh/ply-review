import httpx
import pytest
import respx

from backend.config import Config
from backend.fetch.client import API, ChessComClient, ChessComError, GameNotFound, UserNotFound
from backend.fetch.models import format_time_control, game_id_from_url

PGN = '[Event "Live Chess"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n'


def game(gid, end_time, white="ramisalahh", black="opp", wres="win", bres="checkmated",
         rules="chess"):
    return {
        "url": f"https://www.chess.com/game/live/{gid}",
        "pgn": PGN,
        "end_time": end_time,
        "time_control": "600",
        "time_class": "rapid",
        "rules": rules,
        "white": {"username": white, "rating": 1200, "result": wres},
        "black": {"username": black, "rating": 1210, "result": bres},
    }


@pytest.fixture
def cfg(tmp_path):
    c = Config()
    c.storage.cache_dir = tmp_path / "cache"
    c.chesscom.max_retries = 3
    return c


@pytest.fixture
def sleeps():
    return []


@pytest.fixture
def client(cfg, sleeps):
    c = ChessComClient(cfg, sleep=sleeps.append)
    yield c
    c.close()


ARCH = f"{API}/player/ramisalahh/games/archives"
M1 = f"{API}/player/ramisalahh/games/2024/01"
M2 = f"{API}/player/ramisalahh/games/2024/02"


def mock_two_months():
    respx.get(ARCH).respond(json={"archives": [M1, M2]})
    respx.get(M1).respond(json={"games": [game(1, 100), game(2, 200)]})
    respx.get(M2).respond(json={"games": [
        game(3, 300), game(4, 400, rules="chess960"), game(5, 500, white="opp", black="ramisalahh",
                                                        wres="resigned", bres="win"),
    ]})


@respx.mock
def test_recent_games_newest_first_skips_variants(client):
    mock_two_months()
    games = client.recent_games("RamiSalahh", limit=10)
    assert [g.game_id for g in games] == ["live/5", "live/3", "live/2", "live/1"]
    g = games[0]
    assert g.color_of("ramisalahh") == "black"
    assert g.outcome_for("ramisalahh") == "win"
    assert g.result_tag == "0-1"


@respx.mock
def test_limit_stops_before_older_months(client):
    mock_two_months()
    client.recent_games("ramisalahh", limit=2)
    assert not respx.routes[1].called  # M1 never requested


@respx.mock
def test_past_months_cached_forever(client):
    mock_two_months()
    client.recent_games("ramisalahh", limit=10)
    client.cfg.chesscom.archives_ttl_seconds = 0
    client.recent_games("ramisalahh", limit=10)
    assert respx.routes[0].call_count == 2  # archives list refreshed
    assert respx.routes[1].call_count == 1  # past month not refetched


@respx.mock
def test_offline_uses_cache(cfg, client):
    mock_two_months()
    client.recent_games("ramisalahh", limit=10)
    off = ChessComClient(cfg, offline=True)
    assert len(off.recent_games("ramisalahh", limit=10)) == 4


def test_offline_without_cache_errors(cfg):
    with pytest.raises(ChessComError):
        ChessComClient(cfg, offline=True).archives("ramisalahh")


@respx.mock
def test_429_retries_with_retry_after(client, sleeps):
    respx.get(ARCH).mock(side_effect=[
        httpx.Response(429, headers={"Retry-After": "7"}),
        httpx.Response(503),
        httpx.Response(200, json={"archives": []}),
    ])
    assert client.archives("ramisalahh") == []
    assert sleeps[0] == 7
    assert 2 <= sleeps[1] <= 3  # base * 2**1 + jitter


@respx.mock
def test_gives_up_after_max_retries(client, sleeps):
    respx.get(ARCH).respond(429)
    with pytest.raises(ChessComError):
        client.archives("ramisalahh")
    assert len(sleeps) == 3


@respx.mock
def test_unknown_user(client):
    respx.get(f"{API}/player/nobody/games/archives").respond(404)
    with pytest.raises(UserNotFound):
        client.archives("nobody")


@respx.mock
def test_etag_revalidation(cfg, client):
    route = respx.get(ARCH).mock(side_effect=[
        httpx.Response(200, json={"archives": [M1]}, headers={"ETag": '"abc"'}),
        httpx.Response(304),
    ])
    client.archives("ramisalahh")
    assert client.archives("ramisalahh", refresh=True) == [M1]
    assert route.calls[1].request.headers["If-None-Match"] == '"abc"'


@respx.mock
def test_find_game_by_index_and_url(client):
    mock_two_months()
    assert client.find_game("ramisalahh", "2").game_id == "live/3"
    url = "https://www.chess.com/game/live/1?move=3"
    assert client.find_game("ramisalahh", url).game_id == "live/1"
    with pytest.raises(GameNotFound):
        client.find_game("ramisalahh", "https://www.chess.com/game/live/999")
    with pytest.raises(GameNotFound):
        client.find_game("ramisalahh", "99")


def test_user_agent_is_descriptive(client):
    assert client.http.headers["User-Agent"].startswith("PlyReview/")


@pytest.mark.parametrize("tc,label", [
    ("600", "10 min"), ("180+2", "3|2"), ("60", "1 min"), ("30", "0.5 min"),
    ("1/86400", "1 day"), ("1/259200", "3 days"), ("900+10", "15|10"),
])
def test_time_control_label(tc, label):
    assert format_time_control(tc) == label


@pytest.mark.parametrize("url,gid", [
    ("https://www.chess.com/game/live/123", "live/123"),
    ("https://www.chess.com/live/game/123", "live/123"),
    ("https://www.chess.com/game/daily/77#move", "daily/77"),
    ("https://example.com/x", None),
])
def test_game_id_from_url(url, gid):
    assert game_id_from_url(url) == gid
