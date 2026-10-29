import threading

import chess
import pytest

from backend.analysis.pipeline import PgnError, evaluate_game
from backend.analysis.winprob import ep_from_cp
from backend.config import EngineConfig, load_config
from backend.engine.stockfish import EngineError, Stockfish, resolve_engine_path, terminal_eval
from backend.engine.types import Eval, Line, PositionAnalysis
from backend.engine.worker import JobRunner

PGN = '[Event "t"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n'


class FakeAnalyzer:
    """Returns scripted lines per position index: [(uci, cp_or_('m', n)), ...]."""

    def __init__(self, script, gate: threading.Event | None = None, fail_at: int | None = None):
        self.script = script
        self.i = 0
        self.gate = gate
        self.fail_at = fail_at
        self.closed = False
        self.name = "Fake"

    def new_game(self):
        self.i = 0

    def analyse(self, board: chess.Board) -> PositionAnalysis:
        if self.gate:
            self.gate.wait(5)
        if self.fail_at is not None and self.i == self.fail_at:
            raise RuntimeError("engine crashed")
        idx = self.i
        self.i += 1
        term = terminal_eval(board)
        if term is not None:
            return PositionAnalysis(fen=board.fen(), terminal=term)
        lines = []
        for uci, score in self.script[idx]:
            e = Eval(mate=score[1]) if isinstance(score, tuple) else Eval(cp=score)
            lines.append(Line(move=uci, eval=e, pv=[uci]))
        return PositionAnalysis(fen=board.fen(), depth=10, lines=lines)

    def close(self):
        self.closed = True


# Scores are from the side to move at each position.
SCRIPT = [
    [("e2e4", 30), ("d2d4", 25)],      # 0 W: plays e4 = best
    [("c7c5", -30), ("e7e5", -35)],    # 1 B: plays e5 = line 2
    [("g1f3", 35), ("b1c3", 20)],      # 2 W: plays Qh5, neither line
    [("b8c6", 0), ("g8f6", -10)],      # 3 B: Nc6 = best
    [("f1c4", 20), ("h5f3", 10)],      # 4 W: Bc4 = best
    [("g7g6", -50), ("d8e7", -60)],    # 5 B: Nf6?? neither line
    [("h5f7", ("m", 1)), ("c4f7", 300)],  # 6 W: Qxf7# = best
    # 7: checkmate, terminal (no script needed)
]


@pytest.fixture
def result():
    return evaluate_game(PGN, FakeAnalyzer(SCRIPT))


def test_one_position_per_ply_plus_final(result):
    assert len(result.positions) == 8
    assert len(result.plies) == 7
    assert result.positions[-1].terminal == Eval(mate=0)


def test_best_move_loses_nothing(result):
    p = result.plies[0]
    assert (p.san, p.best_san) == ("e4", "e4")
    assert p.ep_loss == 0


def test_second_line_used_when_played(result):
    p = result.plies[1]
    assert p.played_eval == Eval(cp=-35)
    assert p.ep_loss == pytest.approx(ep_from_cp(-30) - ep_from_cp(-35))


def test_unscored_move_uses_next_position(result):
    p = result.plies[2]  # Qh5; next position (B to move) is 0 -> W sees 0
    assert p.san == "Qh5"
    assert p.played_eval == Eval(cp=0)
    assert p.ep_loss == pytest.approx(ep_from_cp(35) - 0.5)
    p = result.plies[5]  # Nf6?? allows mate in 1
    assert p.played_eval == Eval(mate=-1)
    assert p.ep_loss == pytest.approx(ep_from_cp(-50))


def test_mating_move(result):
    p = result.plies[6]
    assert p.san == "Qxf7#"
    assert p.ep_best == 1.0 and p.ep_loss == 0
    assert p.eval_after_white == Eval(mate=1)
    assert p.white_ep_after == 1.0


def test_white_pov_after_black_move(result):
    p = result.plies[3]  # after Nc6, W to move with +20
    assert p.color == "black"
    assert p.eval_after_white == Eval(cp=20)


def test_move_numbers_and_pv_san(result):
    assert [(p.move_number, p.color) for p in result.plies[:3]] == [
        (1, "white"), (1, "black"), (2, "white")]
    assert result.plies[2].best_pv_san == ["Nf3"]


def test_build_review(result):
    from backend.analysis.review import build_review
    from backend.config import Config

    r = build_review(result, Config())
    assert len(r.moves) == 7
    assert sum(r.white.counts.values()) == 4 and sum(r.black.counts.values()) == 3
    assert r.book_moves >= 2 and r.moves[0].classification == "book"
    assert r.opening is not None
    assert len(r.white_win) == 8 and r.white_win[-1] == 100
    assert r.white.accuracy > r.black.accuracy
    assert r.white.username == "?" or r.white.username  # PGN has no players
    assert r.model_validate_json(r.model_dump_json()) == r


def test_progress_reports_every_position():
    seen = []
    evaluate_game(PGN, FakeAnalyzer(SCRIPT), lambda d, t, pa: seen.append((d, t)))
    assert seen == [(i, 8) for i in range(1, 9)]


def test_bad_pgn():
    with pytest.raises(PgnError):
        evaluate_game("1. e4 e5 2. Ke3 Ke6 3. Qz9", FakeAnalyzer(SCRIPT))


def test_job_streams_events_and_finishes():
    fake = FakeAnalyzer(SCRIPT)
    job = JobRunner(EngineConfig(), make_analyzer=lambda: fake).submit(PGN)
    events = []
    while (ev := job.events.get(timeout=5)) is not None:
        events.append(ev)
    job.wait(5)
    assert job.status == "done"
    assert job.engine_name == "Fake"
    assert [e.done for e in events] == list(range(1, 9))
    assert job.result.plies[-1].san == "Qxf7#"
    assert fake.closed


def test_job_cancel():
    gate = threading.Event()
    fake = FakeAnalyzer(SCRIPT, gate=gate)
    job = JobRunner(EngineConfig(), make_analyzer=lambda: fake).submit(PGN)
    job.cancel()
    gate.set()
    job.wait(5)
    assert job.status == "cancelled"
    assert fake.closed


def test_job_error_is_reported():
    job = JobRunner(EngineConfig(), make_analyzer=lambda: FakeAnalyzer(SCRIPT, fail_at=3)).submit(
        PGN)
    job.wait(5)
    assert job.status == "error"
    assert "crashed" in job.error


def test_missing_engine_path():
    with pytest.raises(EngineError):
        resolve_engine_path("definitely-not-a-stockfish-binary")


def _engine_or_skip() -> EngineConfig:
    cfg = load_config().engine
    try:
        resolve_engine_path(cfg.path)
    except EngineError:
        pytest.skip("Stockfish not installed")
    return cfg


def test_real_stockfish_finds_mate_and_two_lines():
    cfg = _engine_or_skip()
    cfg.depth, cfg.threads, cfg.hash_mb = 10, 1, 16
    with Stockfish(cfg) as sf:
        board = chess.Board("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4")
        pa = sf.analyse(board)
        assert pa.lines[0].move == "h5f7"
        assert pa.lines[0].eval == Eval(mate=1)
        assert len(pa.lines) == 2
        result = evaluate_game(PGN, sf)
        nf6 = result.plies[5]  # Nf6?? allows mate: Black drops from ~0.47 to 0
        assert nf6.played_eval == Eval(mate=-1)
        assert nf6.ep_played == 0 and nf6.ep_loss > 0.4
