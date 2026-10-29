import chess
import pytest

from backend.analysis.classify import Cls, by_loss, classify_move
from backend.analysis.material import sacrifice_amount, see
from backend.analysis.pipeline import PlyEval
from backend.config import ClassificationConfig
from backend.engine.types import Eval

C = ClassificationConfig()
START = chess.STARTING_FEN
GREEK_GIFT = "r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8"


def ply(fen=START, uci="e2e4", ep_best=0.55, ep_played=None, ep_second=0.54, best_uci=None,
        san="x", ep_loss=None):
    ep_played = ep_best if ep_played is None else ep_played
    best_uci = best_uci or uci
    board = chess.Board(fen)
    return PlyEval(
        ply=1, move_number=1, color="white", san=san or board.san(chess.Move.from_uci(uci)),
        uci=uci, fen_before=fen, fen_after=fen, best_uci=best_uci, best_san="", best_pv_san=[],
        best_eval=Eval(cp=0), second_eval=Eval(cp=0) if ep_second is not None else None,
        played_eval=Eval(cp=0), ep_best=ep_best, ep_second=ep_second, ep_played=ep_played,
        ep_loss=max(0, ep_best - ep_played) if ep_loss is None else ep_loss,
        eval_after_white=Eval(cp=0), white_ep_after=0.5,
    )


def cls(p, prev=None, book=False):
    return classify_move(p, prev, book, C)[0]


@pytest.mark.parametrize("loss,expected", [
    (0.0, Cls.EXCELLENT), (0.02, Cls.EXCELLENT), (0.021, Cls.GOOD), (0.05, Cls.GOOD),
    (0.051, Cls.INACCURACY), (0.10, Cls.INACCURACY), (0.11, Cls.MISTAKE), (0.20, Cls.MISTAKE),
    (0.201, Cls.BLUNDER), (0.9, Cls.BLUNDER),
])
def test_loss_thresholds(loss, expected):
    assert by_loss(loss, C) == expected


def test_best_move():
    assert cls(ply()) == Cls.BEST


def test_non_best_by_loss():
    assert cls(ply(uci="d2d4", best_uci="e2e4", ep_best=0.55, ep_played=0.54)) == Cls.EXCELLENT
    assert cls(ply(uci="g2g4", best_uci="e2e4", ep_best=0.55, ep_played=0.30)) == Cls.BLUNDER


def test_book_wins():
    assert cls(ply(uci="g2g4", best_uci="e2e4", ep_played=0.2), book=True) == Cls.BOOK


def test_forced_move_is_best_never_great():
    fen = "k7/8/8/8/8/8/r7/6rK w - - 0 1"  # Rg1+: only Kxg1
    assert chess.Board(fen).legal_moves.count() == 1
    assert cls(ply(fen=fen, uci="h1g1", ep_best=0.6, ep_second=None)) == Cls.BEST


def test_great_only_move():
    assert cls(ply(ep_best=0.60, ep_second=0.30)) == Cls.GREAT
    assert cls(ply(ep_best=0.60, ep_second=0.50)) == Cls.BEST


def test_not_great_when_still_completely_winning():
    assert cls(ply(ep_best=0.99, ep_second=0.96)) == Cls.BEST


def test_not_great_when_lost_anyway():
    assert cls(ply(ep_best=0.04, ep_second=0.001)) == Cls.BEST


def test_recapture_is_not_great():
    fen = "rnbqkbnr/ppp2ppp/8/3pp3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3"
    b = chess.Board(fen)
    b.push_san("exd5")
    prev = ply(fen=fen, uci="e4d5", san="exd5")
    recapture = ply(fen=b.fen(), uci="d8d5", ep_best=0.6, ep_second=0.2, san="Qxd5")
    assert cls(recapture, prev) == Cls.BEST
    assert cls(recapture, prev=None) == Cls.GREAT  # same move, but nothing to recapture


def test_brilliant_sacrifice():
    board = chess.Board(GREEK_GIFT)
    move = chess.Move.from_uci("d3h7")
    assert sacrifice_amount(board, move) == 2
    p = ply(fen=GREEK_GIFT, uci="d3h7", ep_best=0.70, ep_second=0.60)
    assert cls(p) == Cls.BRILLIANT


def test_no_brilliant_when_already_completely_winning():
    p = ply(fen=GREEK_GIFT, uci="d3h7", ep_best=0.97, ep_second=0.96)
    assert cls(p) == Cls.BEST


def test_no_brilliant_when_sac_is_bad():
    p = ply(fen=GREEK_GIFT, uci="d3h7", best_uci="h2h3", ep_best=0.60, ep_played=0.40)
    assert cls(p) == Cls.MISTAKE


def test_miss_after_opponent_error():
    prev = ply(ep_best=0.5, ep_played=0.2)          # opponent lost 0.3
    mine = ply(uci="d2d4", best_uci="e2e4", ep_best=0.8, ep_played=0.65)  # gave back 0.15
    assert cls(mine, prev) == Cls.MISS


def test_blunder_stays_blunder_not_miss():
    prev = ply(ep_best=0.5, ep_played=0.2)
    mine = ply(uci="d2d4", best_uci="e2e4", ep_best=0.8, ep_played=0.3)
    assert cls(mine, prev) == Cls.BLUNDER


def test_no_miss_without_opponent_error():
    prev = ply(ep_best=0.5, ep_played=0.48)
    mine = ply(uci="d2d4", best_uci="e2e4", ep_best=0.55, ep_played=0.40)
    assert cls(mine, prev) == Cls.MISTAKE


# --- material -----------------------------------------------------------------

def test_hanging_piece_is_sacrifice():
    b = chess.Board("4k3/8/2p5/8/8/4N3/8/4K3 w - - 0 1")
    assert sacrifice_amount(b, chess.Move.from_uci("e3d5")) == 3  # cxd5 wins the knight
    assert sacrifice_amount(b, chess.Move.from_uci("e3f5")) == 0


def test_even_trade_is_not_sacrifice():
    b = chess.Board("4k3/8/4p3/3n4/8/2N5/8/4K3 w - - 0 1")
    assert sacrifice_amount(b, chess.Move.from_uci("c3d5")) == 0


def test_exchange_sacrifice():
    b = chess.Board("4k3/8/8/8/1p6/2n5/8/2R1K3 w - - 0 1")  # Rxc3 bxc3
    assert sacrifice_amount(b, chess.Move.from_uci("c1c3")) == 2


def test_see_defended_pawn():
    b = chess.Board("4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1")
    assert see(b, chess.D5) == 0
    b = chess.Board("4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1")
    assert see(b, chess.D5) == 1


def test_no_brilliant_when_already_far_ahead():
    # ~+6.5 pawns (EP 0.92): a "sacrifice" here is just converting a won game
    p = ply(fen=GREEK_GIFT, uci="d3h7", ep_best=0.92, ep_second=0.91)
    assert cls(p) == Cls.BEST
