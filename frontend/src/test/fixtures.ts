import { Chess } from "chess.js";
import type { Classification, MoveReview, Review } from "../lib/types";
import { CLASS_ORDER } from "../lib/types";

/** Build a minimal but consistent Review from SAN moves. */
export function makeReview(sans: string[], classes: Classification[] = [],
                           best: string[] = []): Review {
  const chess = new Chess();
  const start = chess.fen();
  const moves: MoveReview[] = sans.map((san, i) => {
    const before = chess.fen();
    const color = chess.turn() === "w" ? "white" : "black";
    const moveNumber = chess.moveNumber();
    const bestSan = best[i] ?? san;
    const probe = new Chess(before);
    const b = probe.move(bestSan);
    const m = chess.move(san);
    return {
      ply: i + 1, move_number: moveNumber, color, san: m.san, uci: m.from + m.to,
      fen_before: before, fen_after: chess.fen(), best_uci: b.from + b.to, best_san: b.san,
      best_pv_san: [b.san], best_eval: { cp: 30, mate: null }, second_eval: null,
      played_eval: { cp: 20, mate: null }, ep_best: 0.53, ep_second: null, ep_played: 0.52,
      ep_loss: 0.01, eval_after_white: { cp: 20, mate: null }, white_ep_after: 0.52,
      classification: classes[i] ?? "best", accuracy: 99, sacrifice: 0, clock: 600 - i,
    };
  });
  const counts = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0])) as Record<Classification,
    number>;
  const player = (color: "white" | "black", username: string) => ({
    color, username, rating: 1000, accuracy: 90, game_rating: 1200, counts: { ...counts },
  });
  return {
    schema_version: 1,
    game: { url: "https://www.chess.com/game/live/1", date: "2026-10-28", result: "1-0",
            time_control: "10 min" },
    engine: "Stockfish 19", depth: 18,
    opening: { eco: "C20", name: "King's Pawn Game", ply: 2 },
    book_moves: 0,
    white: player("white", "alice"),
    black: player("black", "bob"),
    moves,
    key_moments: [],
    white_win: [50, ...moves.map(() => 52)],
    start_fen: start,
    headers: {},
  };
}
