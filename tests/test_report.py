import io

import chess.pgn
import pytest
from rich.console import Console
from test_pipeline import SCRIPT, FakeAnalyzer

from backend.analysis.pipeline import evaluate_game
from backend.analysis.review import build_review
from backend.config import Config
from backend.report.json_out import read_json, write_json
from backend.report.pgn_out import build_pgn, write_pgn
from backend.report.terminal import print_review

PGN_CLK = (
    '[Event "Live Chess"]\n[White "w"]\n[Black "b"]\n[Result "1-0"]\n\n'
    '1. e4 {[%clk 0:09:58]} 1... e5 {[%clk 0:09:57]} 2. Qh5 {[%clk 0:09:50]} '
    '2... Nc6 {[%clk 0:09:40]} 3. Bc4 {[%clk 0:09:30]} 3... Nf6 {[%clk 0:09:00]} '
    '4. Qxf7# {[%clk 0:09:20]} 1-0\n'
)


@pytest.fixture
def review():
    ev = evaluate_game(PGN_CLK, FakeAnalyzer(SCRIPT), engine_name="Fake", depth=12)
    return build_review(ev, Config())


def test_clocks_kept(review):
    assert review.moves[0].clock == 598
    assert review.moves[-1].clock == 560


def test_key_moments(review):
    km = review.key_moments
    assert [k.san for k in km] == ["Nf6"]
    k = km[0]
    assert k.classification == "blunder"
    assert k.best_san == "g6"
    assert k.white_win_after == 100


def test_key_moments_limit_and_order():
    cfg = Config()
    cfg.report.key_moments = 1
    script = [list(s) for s in SCRIPT]
    script[2] = [("g1f3", 200), ("b1c3", 150)]  # makes 2.Qh5 lose a lot too
    ev = evaluate_game(PGN_CLK, FakeAnalyzer(script))
    r = build_review(ev, cfg)
    assert len([k for k in r.key_moments if k.classification != "brilliant"]) == 1
    assert r.key_moments[0].san == "Nf6"  # the biggest loss wins


def parse(review) -> chess.pgn.Game:
    text = str(build_pgn(review))
    return chess.pgn.read_game(io.StringIO(text))


def test_pgn_roundtrip_mainline(review):
    g = parse(review)
    assert [n.san() for n in g.mainline()] == ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]
    assert g.headers["Annotator"].startswith("Ply Review (Fake")
    assert g.headers["Result"] == "1-0"
    assert "Accuracy" in g.comment


def test_pgn_nags_evals_clocks(review):
    nodes = list(g := parse(review).mainline())
    assert g is not None
    nf6 = nodes[5]
    assert chess.pgn.NAG_BLUNDER in nf6.nags
    assert "g6 was best" in nf6.comment
    assert nf6.eval().white().mate() == 1
    assert nodes[0].clock() == 598
    assert "Book" in nodes[0].comment
    assert nodes[-1].eval() is None  # checkmate: no eval


def test_pgn_variation_for_mistakes(review):
    nodes = list(parse(review).mainline())
    before_nf6 = nodes[4]
    assert len(before_nf6.variations) == 2
    var = before_nf6.variations[1]
    assert var.san() == "g6"
    assert var.eval() is not None


def test_write_files(review, tmp_path):
    write_json(review, tmp_path / "r.json")
    assert read_json(tmp_path / "r.json") == review
    write_pgn(review, tmp_path / "r.pgn")
    assert chess.pgn.read_game(io.StringIO((tmp_path / "r.pgn").read_text())) is not None
    write_json(review, tmp_path / "small.json", include_positions=False)
    assert "positions" not in (tmp_path / "small.json").read_text()[:200000]


def test_terminal_output(review):
    console = Console(record=True, width=140)
    print_review(console, review, my_color="black")
    out = console.export_text()
    assert "Key moments" in out and "Summary" in out and "blunder" in out
