// Port of backend/analysis/pipeline.py: PGN + one engine search per position
// -> per-move evaluation. A move's value comes from the position before it when
// the engine already scored it (line 1 or 2), else from the position after it.
import { Chess, type Move } from "chess.js";
import type { EnginePool, PoolProgress } from "../engine/pool";
import { gamePositions } from "../engine/positions";
import { bestEval, type PositionAnalysis, type SearchLimits } from "../engine/types";
import type { Eval } from "../lib/types";
import { expectedPoints, flipped, whiteEp } from "./winprob";

export interface PlyEval {
  ply: number;
  move_number: number;
  color: "white" | "black";
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  best_uci: string;
  best_san: string;
  best_pv_san: string[];
  best_eval: Eval;
  second_eval: Eval | null;
  played_eval: Eval;
  ep_best: number;
  ep_second: number | null;
  ep_played: number;
  ep_loss: number;
  eval_after_white: Eval;
  white_ep_after: number;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  moves: Move[];
}

export class PgnError extends Error {}

export function parseGame(pgn: string): ParsedGame {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (e) {
    throw new PgnError(`Could not read PGN: ${(e as Error).message}`);
  }
  const moves = chess.history({ verbose: true });
  if (moves.length === 0) throw new PgnError("The PGN has no moves");
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(chess.getHeaders())) if (v != null) headers[k] = String(v);
  return { headers, startFen: moves[0].before, moves };
}

/** SAN for a UCI line from `fen`, stopping at the first illegal move. */
export function sanLine(fen: string, ucis: string[], limit = 10): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const u of ucis.slice(0, limit)) {
    try {
      out.push(chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

function whitePov(e: Eval, whiteToMove: boolean): Eval {
  return whiteToMove ? e : flipped(e);
}

export function buildPlies(game: ParsedGame, positions: PositionAnalysis[]): PlyEval[] {
  return game.moves.map((m, i) => {
    const before = positions[i];
    const after = positions[i + 1];
    const moverWhite = m.color === "w";
    const uci = m.lan;
    const best = before.lines[0];
    const second = before.lines.length > 1 ? before.lines[1] : null;

    let played: Eval;
    if (uci === best.move) played = best.eval;
    else if (second && uci === second.move) played = second.eval;
    else played = flipped(bestEval(after));

    const epBest = expectedPoints(best.eval);
    const epPlayed = expectedPoints(played);
    const pvSan = sanLine(m.before, best.pv);
    const afterEval = bestEval(after);
    return {
      ply: i + 1,
      move_number: Number(m.before.split(" ")[5]),
      color: moverWhite ? "white" : "black",
      san: m.san,
      uci,
      fen_before: m.before,
      fen_after: m.after,
      best_uci: best.move,
      best_san: pvSan[0] ?? best.move,
      best_pv_san: pvSan,
      best_eval: best.eval,
      second_eval: second ? second.eval : null,
      played_eval: played,
      ep_best: epBest,
      ep_second: second ? expectedPoints(second.eval) : null,
      ep_played: epPlayed,
      ep_loss: Math.max(0, epBest - epPlayed),
      eval_after_white: whitePov(afterEval, !moverWhite),
      white_ep_after: whiteEp(afterEval, !moverWhite),
    };
  });
}

/** Run the engine on every position of the game. */
export async function evaluatePositions(
  game: ParsedGame, pool: EnginePool, limits: SearchLimits,
  onProgress?: (p: PoolProgress) => void, signal?: AbortSignal,
): Promise<PositionAnalysis[]> {
  const jobs = gamePositions(game.moves.map((m) => m.san), game.startFen);
  return pool.analyseAll(jobs, limits, onProgress, signal);
}
