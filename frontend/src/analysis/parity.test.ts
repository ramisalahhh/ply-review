// The TypeScript analysis must give the same review as the Python backend for
// the same engine output. Fixtures come from scripts/export_web_data.py.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PositionAnalysis } from "../engine/types";
import type { Review } from "../lib/types";
import { CONFIG } from "./config";
import { bookFromJson } from "./opening";
import { parseGame } from "./pipeline";
import { buildReview } from "./review";

interface ParityCase {
  name: string;
  pgn: string;
  engine: string;
  depth: number;
  positions: PositionAnalysis[];
  expected: Review;
}

const cases = Object.entries(
  import.meta.glob("../data/parity/*.json", { eager: true, import: "default" }),
).map(([, c]) => c as ParityCase);

// vitest runs from frontend/
const book = bookFromJson(JSON.parse(readFileSync("public/data/book.json", "utf8")));

function build(c: ParityCase): Review {
  return buildReview(parseGame(c.pgn), c.positions,
                     { engine: c.engine, depth: c.depth, book, config: CONFIG, pgn: c.pgn });
}

const close = (a: number | null, b: number | null) => {
  if (a === null || b === null) expect(a).toBe(b);
  else expect(a).toBeCloseTo(b, 9);
};

describe("same results as the Python backend", () => {
  it("has fixtures", () => {
    expect(cases.length).toBeGreaterThanOrEqual(4);
  });

  for (const c of cases) {
    describe(c.name, () => {
      const got = build(c);
      const want = c.expected;

      it("moves: SAN, UCI, numbering, clocks", () => {
        expect(got.moves.map((m) => [m.ply, m.move_number, m.color, m.san, m.uci, m.clock]))
          .toEqual(want.moves.map((m) => [m.ply, m.move_number, m.color, m.san, m.uci, m.clock]));
      });

      it("classification and sacrifice per move", () => {
        expect(got.moves.map((m) => `${m.san}:${m.classification}:${m.sacrifice}`))
          .toEqual(want.moves.map((m) => `${m.san}:${m.classification}:${m.sacrifice}`));
      });

      it("expected points and evals per move", () => {
        got.moves.forEach((m, i) => {
          const w = want.moves[i];
          close(m.ep_best, w.ep_best);
          close(m.ep_played, w.ep_played);
          close(m.ep_loss, w.ep_loss);
          close(m.ep_second, w.ep_second);
          close(m.white_ep_after, w.white_ep_after);
          close(m.accuracy, w.accuracy);
          expect(m.eval_after_white).toEqual(w.eval_after_white);
          expect(m.played_eval).toEqual(w.played_eval);
          expect([m.best_san, ...m.best_pv_san]).toEqual([w.best_san, ...w.best_pv_san]);
        });
      });

      it("player summaries", () => {
        for (const color of ["white", "black"] as const) {
          const g = got[color];
          const w = want[color];
          expect([g.username, g.rating, g.game_rating, g.counts])
            .toEqual([w.username, w.rating, w.game_rating, w.counts]);
          close(g.accuracy, w.accuracy);
        }
      });

      it("opening, book moves, key moments, graph", () => {
        expect(got.opening).toEqual(want.opening);
        expect(got.book_moves).toBe(want.book_moves);
        expect(got.key_moments.map((k) => [k.ply, k.classification, k.best_san]))
          .toEqual(want.key_moments.map((k) => [k.ply, k.classification, k.best_san]));
        got.white_win.forEach((v, i) => close(v, want.white_win[i]));
      });
    });
  }
});
