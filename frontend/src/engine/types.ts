// Mirrors backend/engine/types.py. Scores are from the side to move's view.
import type { Eval } from "../lib/types";

export type { Eval };

export interface Line {
  move: string;   // UCI of the first move
  eval: Eval;
  pv: string[];   // UCI moves, starting with `move`
}

export interface PositionAnalysis {
  fen: string;
  depth: number;
  lines: Line[];           // best first; empty for finished positions
  terminal: Eval | null;   // set when the game is over in this position
}

export interface SearchLimits {
  depth: number;
  movetimeMs: number;  // 0 = no time cap
  multipv: number;
}

/** One position to analyse. `terminal` is set by the caller for finished games. */
export interface PositionJob {
  fen: string;
  terminal?: Eval | null;
}

export function bestEval(pa: PositionAnalysis): Eval {
  return pa.terminal ?? pa.lines[0].eval;
}
