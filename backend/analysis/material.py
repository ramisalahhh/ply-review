"""Material and sacrifice detection with static exchange evaluation (SEE).

A move sacrifices material when, after it, the opponent can win more material
by capturing (with best capture sequences on one square) than the move itself
just captured. Examples:
    piece left hanging            0 - 3 = -3   -> sacrifice of 3
    Bxf7+ Kxf7                    1 - 3 = -2   -> sacrifice of 2
    exchange sac Rxc3 bxc3        3 - 5 = -2   -> sacrifice of 2
    even trade Nxd5 exd5          3 - 3 =  0   -> no sacrifice
"""

from __future__ import annotations

import chess

VALUES = {
    chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
    chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0,
}


def piece_value(board: chess.Board, square: chess.Square) -> int:
    p = board.piece_at(square)
    return VALUES[p.piece_type] if p else 0


def captured_value(board: chess.Board, move: chess.Move) -> int:
    if board.is_en_passant(move):
        return VALUES[chess.PAWN]
    return piece_value(board, move.to_square)


def _least_valuable_capture(board: chess.Board, square: chess.Square) -> chess.Move | None:
    best = None
    best_val = 99
    for m in board.legal_moves:
        if m.to_square != square or not board.is_capture(m):
            continue
        v = piece_value(board, m.from_square)
        if v == 0:  # king: only if nothing else can take
            v = 50
        if v < best_val:
            best, best_val = m, v
    return best


def see(board: chess.Board, square: chess.Square) -> int:
    """Material the side to move can win by capturing on `square` (>= 0)."""
    move = _least_valuable_capture(board, square)
    if move is None:
        return 0
    gain = captured_value(board, move)
    board.push(move)
    try:
        gain -= see(board, square)
    finally:
        board.pop()
    return max(0, gain)


def max_threat(board: chess.Board) -> int:
    """Most material the side to move can win with one capture sequence."""
    them = not board.turn
    targets = {m.to_square for m in board.legal_moves
               if board.is_capture(m) and board.color_at(m.to_square) == them}
    return max((see(board, sq) for sq in targets), default=0)


def sacrifice_amount(board: chess.Board, move: chess.Move) -> int:
    """Material given up by `move` (0 if none). `board` is before the move."""
    taken = captured_value(board, move)
    board.push(move)
    try:
        threat = max_threat(board)
    finally:
        board.pop()
    return max(0, threat - taken)
