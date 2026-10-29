import math

import chess
import pytest

from backend.analysis.accuracy import (
    game_accuracy,
    move_accuracy,
    per_move_accuracies,
    window_weights,
)
from backend.analysis.opening import book_flags, detect_opening, load_book
from backend.analysis.rating import estimate_rating, interpolate
from backend.config import DEFAULT_CURVE


def lichess(diff):
    raw = 103.1668100711649 * math.exp(-0.04354415386753951 * diff) - 3.166924740191411
    return max(0, min(100, raw + 1))


def test_no_loss_is_100():
    assert move_accuracy(50, 50) == 100
    assert move_accuracy(40, 60) == 100


@pytest.mark.parametrize("diff", [1, 5, 10, 25, 50, 90])
def test_move_accuracy_formula(diff):
    assert move_accuracy(80, 80 - diff) == pytest.approx(lichess(diff))


def test_move_accuracy_bounds():
    assert move_accuracy(100, 0) == 0
    assert 0 <= move_accuracy(70, 69.9) <= 100


def test_perfect_game_is_100():
    acc = game_accuracy([55.0] * 41)
    assert acc["white"] == pytest.approx(100)
    assert acc["black"] == pytest.approx(100)


def test_colors_alternate():
    # White holds 50, Black drops 30 Win% on each of its moves then White recovers? no:
    series = [50, 50, 80, 80, 80]  # move 2 (Black) loses 30 points for Black
    accs = per_move_accuracies(series)
    assert accs == [100, pytest.approx(lichess(30)), 100, 100]


def test_black_to_move_first():
    series = [50, 80, 80]  # Black moves first and loses 30
    assert per_move_accuracies(series, white_first=False)[0] == pytest.approx(lichess(30))


def test_one_blunder_hurts_more_than_spread_small_errors():
    blunder = [50.0] * 21
    blunder[11:] = [10.0] * 10          # White loses 40 once (ply 11)
    small = [50 - 4 * ((i + 1) // 2) for i in range(21)]  # White loses 4 on each move
    assert game_accuracy(blunder)["white"] < game_accuracy(small)["white"] < 100
    assert game_accuracy(blunder)["black"] == pytest.approx(100)


def test_harmonic_mean_punishes_zero():
    series = [50.0] * 11
    series[5:] = [0.0] * 6  # Black? index 4->5 is ply 5 (White) losing everything
    acc = game_accuracy(series)["white"]
    assert acc < 60


def test_window_weights_one_per_move():
    for n in (2, 5, 21, 81, 200):
        assert len(window_weights([50.0 + i % 7 for i in range(n)])) == n - 1


def test_weights_clamped():
    w = window_weights([0, 100] * 20)
    assert max(w) == 12 and min(w) >= 0.5


def test_empty_side():
    assert game_accuracy([50, 50])["black"] is None


# --- rating -----------------------------------------------------------------

def test_interpolate():
    curve = [(0, 0), (50, 1000), (100, 2000)]
    assert interpolate(curve, 25) == 500
    assert interpolate(curve, -5) == 0
    assert interpolate(curve, 120) == 2000


def test_rating_monotonic_and_rounded():
    values = [estimate_rating(a, DEFAULT_CURVE, 40) for a in range(0, 101, 5)]
    assert values == sorted(values)
    assert all(v % 50 == 0 for v in values)


def test_short_game_pulled_to_real_rating():
    long = estimate_rating(95, DEFAULT_CURVE, 40, player_rating=400)
    short = estimate_rating(95, DEFAULT_CURVE, 4, player_rating=400)
    assert short < long
    assert estimate_rating(None, DEFAULT_CURVE, 10) is None


# --- opening ----------------------------------------------------------------

def moves(san: str) -> list[chess.Move]:
    b = chess.Board()
    out = []
    for s in san.split():
        m = b.parse_san(s)
        out.append(m)
        b.push(m)
    return out


def test_book_loaded():
    book = load_book()
    assert len(book.book) > 3000
    assert len(book.named) > 3000


def test_detect_italian():
    op = detect_opening(moves("e4 e5 Nf3 Nc6 Bc4"), load_book())
    assert op.eco.startswith("C5")
    assert "Italian" in op.name


def test_book_ends_at_novelty():
    flags = book_flags(moves("e4 e5 Nf3 Nc6 Bc4 Bc5 Kf1 Ke7"), load_book())
    assert flags[:6] == [True] * 6
    assert flags[6:] == [False, False]


def test_book_again_after_transposing_back():
    # 2.Nc3 Nc6 3.Bb5 is off the named lines; 3...Nf6 4.Nf3 reaches the Four Knights Spanish
    flags = book_flags(moves("e4 e5 Nc3 Nc6 Bb5 Nf6 Nf3"), load_book())
    assert flags[:4] == [True] * 4
    assert flags[6] is True


def test_transposition_found():
    a = detect_opening(moves("d4 Nf6 c4 e6 Nc3 Bb4"), load_book())
    b = detect_opening(moves("c4 e6 Nc3 Nf6 d4 Bb4"), load_book())
    assert a.name == b.name and "Nimzo" in a.name


# --- fitted (chess.com-like) accuracy ----------------------------------------

from backend.analysis.accuracy import fitted_accuracy, power_mean  # noqa: E402

M = dict(k=0.03, p=1.25, q=0.5, a=1.41851, b=-46.8498)


def test_power_mean_family():
    xs = [100.0, 25.0]
    assert power_mean(xs, 1) == pytest.approx(62.5)
    assert power_mean(xs, 0) == pytest.approx(50.0)
    assert power_mean(xs, -1) == pytest.approx(40.0)


def test_fitted_perfect_and_bounds():
    assert fitted_accuracy([0.0] * 30, **M) == pytest.approx(min(100.0, 1.41851 * 100 - 46.8498))
    assert fitted_accuracy([], **M) is None
    assert 0 <= fitted_accuracy([90.0] * 10, **M) <= 100


def test_fitted_is_gentler_than_lichess_on_one_blunder_in_a_short_game():
    # 8 good moves and one blunder that throws away 45% winning chances
    losses = [0.5] * 8 + [45.0]
    fitted = fitted_accuracy(losses, **M)
    series = [50.0]
    for d in losses:  # White moves; Black replies perfectly
        series += [series[-1] - d, series[-1] - d]
    lichess = game_accuracy(series[:-1])["white"]
    assert fitted > lichess + 10


def test_fitted_decreases_with_bigger_losses():
    a = fitted_accuracy([1.0] * 20, **M)
    b = fitted_accuracy([5.0] * 20, **M)
    c = fitted_accuracy([15.0] * 20, **M)
    assert a > b > c
