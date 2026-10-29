import math

import pytest

from backend.analysis.winprob import ep_from_cp, expected_points, white_ep, win_percent
from backend.engine.types import Eval


def test_equal_position_is_half():
    assert expected_points(Eval(cp=0)) == pytest.approx(0.5)


def test_symmetric():
    for cp in (35, 120, 400, 999):
        assert ep_from_cp(cp) + ep_from_cp(-cp) == pytest.approx(1.0)


def test_monotonic():
    values = [ep_from_cp(cp) for cp in range(-1200, 1201, 50)]
    assert values == sorted(values)


def test_matches_lichess_win_percent():
    # Lichess: 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
    for cp in (-300, -50, 0, 80, 250):
        lichess = 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)
        assert win_percent(Eval(cp=cp)) == pytest.approx(lichess)


def test_known_points():
    assert ep_from_cp(100) == pytest.approx(0.591, abs=1e-3)
    assert ep_from_cp(300) == pytest.approx(0.752, abs=1e-3)


def test_clamped_beyond_ten_pawns():
    assert ep_from_cp(1000) == ep_from_cp(5000)
    assert ep_from_cp(-1000) == ep_from_cp(-5000)


def test_mate_beats_any_cp():
    assert expected_points(Eval(mate=20)) > ep_from_cp(10_000)
    assert expected_points(Eval(mate=-20)) < ep_from_cp(-10_000)


def test_faster_mate_is_better():
    assert expected_points(Eval(mate=1)) > expected_points(Eval(mate=5)) > expected_points(
        Eval(mate=15))
    assert expected_points(Eval(mate=1)) == 1.0


def test_being_mated():
    assert expected_points(Eval(mate=0)) == 0.0
    assert expected_points(Eval(mate=-1)) == pytest.approx(0.0)
    assert expected_points(Eval(mate=-3)) < 0.01


def test_flip_preserves_total():
    for e in (Eval(cp=137), Eval(cp=-40), Eval(mate=3), Eval(mate=-2)):
        assert expected_points(e) + expected_points(e.flipped()) == pytest.approx(1.0)


def test_checkmated_flips_to_mate_delivered():
    assert Eval(mate=0).flipped() == Eval(mate=1)


def test_white_pov():
    e = Eval(cp=200)
    assert white_ep(e, white_to_move=True) == pytest.approx(ep_from_cp(200))
    assert white_ep(e, white_to_move=False) == pytest.approx(ep_from_cp(-200))


def test_eval_requires_exactly_one():
    with pytest.raises(ValueError):
        Eval()
    with pytest.raises(ValueError):
        Eval(cp=1, mate=1)
