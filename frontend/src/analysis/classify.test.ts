import { describe, expect, it } from "vitest";
import { classifyMove } from "./classify";
import { CONFIG } from "./config";
import type { PlyEval } from "./pipeline";

const GREEK_GIFT = "r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8";
const ev = { cp: 0, mate: null };

function bxh7(epBest: number): PlyEval {
  return {
    ply: 15, move_number: 8, color: "white", san: "Bxh7+", uci: "d3h7", fen_before: GREEK_GIFT,
    fen_after: GREEK_GIFT, best_uci: "d3h7", best_san: "Bxh7+", best_pv_san: [], best_eval: ev,
    second_eval: ev, played_eval: ev, ep_best: epBest, ep_second: epBest - 0.01,
    ep_played: epBest, ep_loss: 0, eval_after_white: ev, white_ep_after: epBest,
  };
}

describe("Brilliant", () => {
  it("is given for a sound sacrifice in a normal position", () => {
    expect(classifyMove(bxh7(0.7), null, false, CONFIG.classification)).toEqual(["brilliant", 2]);
  });

  it("is not given when the player is already far ahead (~ +6 pawns)", () => {
    expect(classifyMove(bxh7(0.92), null, false, CONFIG.classification)[0]).toBe("best");
  });
});
