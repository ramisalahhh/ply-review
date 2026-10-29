// Port of backend/analysis/material.py: sacrifice detection with static
// exchange evaluation (SEE) on legal captures.
import { Chess, type Move, type Square } from "chess.js";

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function capturedValue(m: Move): number {
  return m.captured ? VALUES[m.captured] : 0; // en passant reports a captured pawn too
}

function leastValuableCapture(chess: Chess, square: Square): Move | null {
  let best: Move | null = null;
  let bestVal = 99;
  for (const m of chess.moves({ verbose: true })) {
    if (m.to !== square || !m.captured) continue;
    let v = VALUES[m.piece];
    if (v === 0) v = 50; // king: only if nothing else can take
    if (v < bestVal) {
      best = m;
      bestVal = v;
    }
  }
  return best;
}

/** Material the side to move can win by capturing on `square` (>= 0). */
export function see(chess: Chess, square: Square): number {
  const move = leastValuableCapture(chess, square);
  if (!move) return 0;
  let gain = capturedValue(move);
  chess.move(move);
  try {
    gain -= see(chess, square);
  } finally {
    chess.undo();
  }
  return Math.max(0, gain);
}

/** Most material the side to move can win with one capture sequence. */
export function maxThreat(chess: Chess): number {
  const targets = new Set<Square>();
  for (const m of chess.moves({ verbose: true })) {
    if (m.captured) targets.add(m.to);
  }
  let best = 0;
  for (const sq of targets) best = Math.max(best, see(chess, sq));
  return best;
}

/** Material given up by `uci` from `fen` (0 if none). */
export function sacrificeAmount(fen: string, uci: string): number {
  const chess = new Chess(fen);
  const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  const taken = capturedValue(m);
  return Math.max(0, maxThreat(chess) - taken);
}
