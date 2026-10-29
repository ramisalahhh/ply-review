// Mirrors backend/report/schema.py and backend/api/main.py.

export type Classification =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";

export const CLASS_ORDER: Classification[] = [
  "brilliant", "great", "best", "excellent", "good", "book",
  "inaccuracy", "mistake", "miss", "blunder",
];

export interface Eval {
  cp: number | null;
  mate: number | null;
}

export interface MoveReview {
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
  classification: Classification;
  accuracy: number;
  sacrifice: number;
  clock: number | null;
}

export interface PlayerSummary {
  color: "white" | "black";
  username: string;
  rating: number | null;
  accuracy: number | null;      // fitted to chess.com (accuracy.model), else Lichess
  accuracy_raw?: number | null; // the plain Lichess formula
  game_rating: number | null;
  counts: Record<Classification, number>;
}

export interface KeyMoment {
  ply: number;
  move_number: number;
  color: "white" | "black";
  san: string;
  classification: Classification;
  ep_loss: number;
  white_win_before: number;
  white_win_after: number;
  best_san: string;
  best_line: string[];
}

export interface Review {
  schema_version: number;
  game: { url: string | null; date: string | null; result: string; time_control: string | null;
          termination?: string | null };
  engine: string;
  depth: number;
  opening: { eco: string; name: string; ply: number } | null;
  book_moves: number;
  white: PlayerSummary;
  black: PlayerSummary;
  moves: MoveReview[];
  key_moments: KeyMoment[];
  white_win: number[];
  start_fen: string;
  headers: Record<string, string>;
}

export interface GameSummary {
  index: number;
  url: string;
  game_id: string;
  date: string;
  time_control: string;
  time_class: string;
  rated: boolean;
  white: string;
  white_rating: number | null;
  black: string;
  black_rating: number | null;
  result: string;
  my_color: "white" | "black";
  outcome: "win" | "loss" | "draw";
  opponent: string;
  opponent_rating: number | null;
  review_id: string | null;
}

export interface AnalysisStatus {
  job_id: string | null;
  review_id: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  done: number;
  total: number;
  error: string | null;
}
