import { Chess } from "chess.js";
import type { Eval, PositionJob } from "./types";

/** Score for a finished position (mirrors backend terminal_eval), or null. */
export function terminalEval(chess: Chess): Eval | null {
  if (chess.isCheckmate()) return { cp: null, mate: 0 };
  if (chess.isStalemate() || chess.isInsufficientMaterial() || chess.isDrawByFiftyMoves()
      || chess.isThreefoldRepetition()) {
    return { cp: 0, mate: null };
  }
  return null;
}

/** Every position of a game (start first), with game-over positions marked. */
export function gamePositions(sans: string[], startFen?: string): PositionJob[] {
  const chess = startFen ? new Chess(startFen) : new Chess();
  const jobs: PositionJob[] = [{ fen: chess.fen(), terminal: terminalEval(chess) }];
  for (const san of sans) {
    chess.move(san);
    jobs.push({ fen: chess.fen(), terminal: terminalEval(chess) });
  }
  return jobs;
}
