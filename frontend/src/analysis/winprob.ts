// Port of backend/analysis/winprob.py: engine eval -> expected points (0-1)
// for the side to move, using the Lichess logistic curve.
import type { Eval } from "../lib/types";

const K = 0.00368208;
const CP_CLAMP = 1000;
const MATE_BASE = 1.0;
const MATE_STEP = 0.001;
const MATE_FLOOR_MOVES = 20;

export function epFromCp(cp: number): number {
  const c = Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp));
  return 1 / (1 + Math.exp(-K * c));
}

function mateEp(moves: number): number {
  return MATE_BASE - MATE_STEP * (Math.min(moves, MATE_FLOOR_MOVES) - 1);
}

export function expectedPoints(e: Eval): number {
  if (e.mate !== null) {
    if (e.mate > 0) return mateEp(e.mate);
    if (e.mate === 0) return 0;
    return 1 - mateEp(-e.mate);
  }
  return epFromCp(e.cp ?? 0);
}

export function whiteEp(e: Eval, whiteToMove: boolean): number {
  const ep = expectedPoints(e);
  return whiteToMove ? ep : 1 - ep;
}

/** The same score from the other side's view (mate 0 = checkmated -> mate delivered). */
export function flipped(e: Eval): Eval {
  if (e.mate !== null) return { cp: null, mate: e.mate !== 0 ? -e.mate : 1 };
  return { cp: -(e.cp ?? 0), mate: null };
}
