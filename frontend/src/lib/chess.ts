import { Chess } from "chess.js";
import type { Eval, MoveReview, Review } from "./types";
import type { LineMove } from "./navigation";

/** Play SAN moves from a FEN; stops at the first move chess.js rejects. */
export function playLine(fen: string, sans: string[]): LineMove[] {
  const chess = new Chess(fen);
  const out: LineMove[] = [];
  for (const san of sans) {
    try {
      const m = chess.move(san);
      out.push({
        san: m.san, from: m.from, to: m.to, fen: chess.fen(),
        capture: m.isCapture() || m.isEnPassant(), check: chess.inCheck(),
      });
    } catch {
      break;
    }
  }
  return out;
}

export function fenAt(review: Review, ply: number): string {
  return ply === 0 ? review.start_fen : review.moves[ply - 1].fen_after;
}

/** "+0.34", "-1.20", "M3", "-M2" (White's view). */
export function formatEval(e: Eval | null | undefined): string {
  if (!e) return "";
  if (e.mate !== null) {
    if (e.mate === 0) return "#";
    return e.mate > 0 ? `M${e.mate}` : `-M${-e.mate}`;
  }
  const v = (e.cp ?? 0) / 100;
  if (Math.abs(v) < 0.05) return "0.0";
  return `${v > 0 ? "+" : ""}${v.toFixed(Math.abs(v) >= 10 ? 0 : 1)}`;
}

export function whiteEvalAt(review: Review, ply: number): Eval | null {
  if (ply === 0) return review.moves[0]?.best_eval ?? null; // White to move at the start
  return review.moves[ply - 1].eval_after_white;
}

export const BETTER_EXISTS = new Set(["excellent", "good", "inaccuracy", "mistake", "miss",
  "blunder"]);

export function showBestArrow(m: MoveReview): boolean {
  return m.uci !== m.best_uci && BETTER_EXISTS.has(m.classification);
}

export function soundKind(san: string): "move" | "capture" | "check" {
  if (san.includes("+") || san.includes("#")) return "check";
  if (san.includes("x")) return "capture";
  return "move";
}

export function formatClock(s: number | null): string {
  if (s === null) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
