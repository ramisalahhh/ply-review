// Port of backend/analysis/review.py: engine evaluation -> full Review.
import { bestEval, type PositionAnalysis } from "../engine/types";
import type { Classification, MoveReview, PlayerSummary, Review } from "../lib/types";
import { CLASS_ORDER } from "../lib/types";
import { fittedAccuracy, gameAccuracy, perMoveAccuracies } from "./accuracy";
import { classifyPlies } from "./classify";
import type { AnalysisConfig } from "./config";
import { keyMoments } from "./moments";
import { bookFlags, detectOpening, type OpeningBook } from "./opening";
import { buildPlies, type ParsedGame } from "./pipeline";
import { estimateRating } from "./rating";
import { whiteEp } from "./winprob";

export interface GameMeta {
  url: string | null;
  date: string | null;
  result: string;
  time_control: string | null;
  termination?: string | null;
}

export function whiteWinSeries(positions: PositionAnalysis[]): number[] {
  return positions.map((pa) => 100 * whiteEp(bestEval(pa), pa.fen.split(" ")[1] === "w"));
}

/** Seconds left after each move, from chess.com's {[%clk h:mm:ss.s]} comments. */
export function clocksFromPgn(pgn: string): (number | null)[] {
  const out: (number | null)[] = [];
  for (const m of pgn.matchAll(/\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g)) {
    out.push(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  }
  return out;
}

const int = (v: string | undefined) => {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && String(n) === v?.trim() ? n : null;
};

export function buildReview(
  game: ParsedGame,
  positions: PositionAnalysis[],
  opts: { engine: string; depth: number; book: OpeningBook; config: AnalysisConfig;
          pgn: string; meta?: GameMeta },
): Review {
  const { config: cfg, book } = opts;
  const h = game.headers;
  const plies = buildPlies(game, positions);
  const fensAfter = game.moves.map((m) => m.after);
  const inBook = bookFlags(fensAfter, book);
  const opening = detectOpening(fensAfter, book);
  const classes = classifyPlies(plies, inBook, cfg.classification);
  const clocks = clocksFromPgn(opts.pgn);

  const whiteWin = whiteWinSeries(positions);
  const whiteFirst = game.startFen.split(" ")[1] === "w";
  const accs = perMoveAccuracies(whiteWin, whiteFirst);
  const rawAcc = gameAccuracy(whiteWin, whiteFirst, cfg.accuracy.window_min,
                              cfg.accuracy.window_max);
  const model = cfg.accuracy.model;
  const fitted = (color: "white" | "black") => model
    ? fittedAccuracy(plies.filter((p, i) => p.color === color
        && !(model.skip_book && classes[i][0] === "book")).map((p) => p.ep_loss * 100), model)
    : rawAcc[color];
  const acc = { white: fitted("white"), black: fitted("black") };

  const moves: MoveReview[] = plies.map((p, i) => ({
    ...p,
    classification: classes[i][0],
    accuracy: accs[i],
    sacrifice: classes[i][1],
    clock: i < clocks.length ? clocks[i] : null,
  }));

  const summary = (color: "white" | "black"): PlayerSummary => {
    const mine = moves.filter((m) => m.color === color);
    const counts = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0])) as Record<Classification,
      number>;
    for (const m of mine) counts[m.classification]++;
    const rating = int(h[color === "white" ? "WhiteElo" : "BlackElo"]);
    return {
      color,
      username: h[color === "white" ? "White" : "Black"] ?? color,
      rating,
      accuracy: acc[color],
      accuracy_raw: rawAcc[color],
      game_rating: estimateRating(acc[color], cfg.rating.curve, mine.length, rating,
                                  cfg.rating.full_weight_moves),
      counts,
    };
  };

  const meta = opts.meta ?? {
    url: h.Link ?? null, date: h.Date ?? null, result: h.Result ?? "*",
    time_control: h.TimeControl ?? null, termination: h.Termination ?? null,
  };
  return {
    schema_version: 1,
    game: meta,
    engine: opts.engine,
    depth: opts.depth,
    opening,
    book_moves: inBook.filter(Boolean).length,
    white: summary("white"),
    black: summary("black"),
    moves,
    key_moments: keyMoments(moves, whiteWin, cfg.report.key_moments, cfg.classification.good),
    white_win: whiteWin,
    start_fen: game.startFen,
    headers: h,
  };
}
