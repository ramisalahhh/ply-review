// Port of backend/analysis/moments.py.
import type { KeyMoment, MoveReview } from "../lib/types";

const BAD = new Set(["inaccuracy", "mistake", "miss", "blunder"]);

export function keyMoments(moves: MoveReview[], whiteWin: number[], limit = 5,
                           minLoss = 0.05): KeyMoment[] {
  // stable sort by loss, biggest first (same tie order as Python's sorted)
  const swings = moves
    .filter((m) => BAD.has(m.classification) && m.ep_loss > minLoss)
    .map((m, i) => ({ m, i }))
    .sort((a, b) => b.m.ep_loss - a.m.ep_loss || a.i - b.i)
    .slice(0, limit)
    .map(({ m }) => m.ply);
  const picked = new Set([...swings,
    ...moves.filter((m) => m.classification === "brilliant").map((m) => m.ply)]);

  return moves.filter((m) => picked.has(m.ply)).map((m) => ({
    ply: m.ply,
    move_number: m.move_number,
    color: m.color,
    san: m.san,
    classification: m.classification,
    ep_loss: m.ep_loss,
    white_win_before: whiteWin[m.ply - 1],
    white_win_after: whiteWin[m.ply],
    best_san: m.best_san,
    best_line: m.best_pv_san,
  }));
}
