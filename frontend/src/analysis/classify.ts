// Port of backend/analysis/classify.py. First matching rule wins:
// Book, (forced -> Best), Brilliant, Great, Miss, Best, then by EP lost.
import { Chess } from "chess.js";
import type { Classification } from "../lib/types";
import type { ClassificationConfig } from "./config";
import { sacrificeAmount } from "./material";
import type { PlyEval } from "./pipeline";

export function byLoss(loss: number, c: ClassificationConfig): Classification {
  if (loss <= c.excellent) return "excellent";
  if (loss <= c.good) return "good";
  if (loss <= c.inaccuracy) return "inaccuracy";
  if (loss <= c.mistake) return "mistake";
  return "blunder";
}

function isRecapture(prev: PlyEval | null, p: PlyEval, chess: Chess): boolean {
  if (!prev) return false;
  const to = p.uci.slice(2, 4);
  const capture = chess.moves({ verbose: true }).some(
    (m) => m.from === p.uci.slice(0, 2) && m.to === to && m.captured);
  return capture && to === prev.uci.slice(2, 4) && prev.san.includes("x");
}

export function classifyMove(p: PlyEval, prev: PlyEval | null, inBook: boolean,
                             c: ClassificationConfig): [Classification, number] {
  if (inBook) return ["book", 0];

  const chess = new Chess(p.fen_before);
  const forced = chess.moves().length === 1;
  const isBest = p.uci === p.best_uci;
  const base: Classification = isBest ? "best" : byLoss(p.ep_loss, c);
  if (forced) return ["best", 0];

  const sac = sacrificeAmount(p.fen_before, p.uci);
  if (sac >= c.brilliant_min_sacrifice
      && p.ep_loss <= c.brilliant_max_loss
      && p.ep_best < c.decided_threshold
      && p.ep_played >= c.brilliant_min_ep_after) {
    return ["brilliant", sac];
  }

  if (isBest && p.ep_second !== null
      && p.ep_best - p.ep_second >= c.great_gap
      && p.ep_second < c.decided_threshold
      && p.ep_best > 1 - c.decided_threshold
      && !(c.great_exclude_recaptures && isRecapture(prev, p, chess))) {
    return ["great", sac];
  }

  if (prev && (base === "inaccuracy" || base === "mistake")
      && prev.ep_loss >= c.miss_opponent_gain
      && p.ep_loss >= c.miss_given_back) {
    return ["miss", sac];
  }
  return [base, sac];
}

export function classifyPlies(plies: PlyEval[], inBook: boolean[],
                              c: ClassificationConfig): [Classification, number][] {
  return plies.map((p, i) => classifyMove(p, i > 0 ? plies[i - 1] : null, inBook[i], c));
}
