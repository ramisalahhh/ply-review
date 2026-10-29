import { describe, expect, it } from "vitest";
import { initNav, keyToAction, navReducer, type NavAction, type NavState } from "./navigation";
import { playLine } from "./chess";

const run = (s: NavState, ...actions: NavAction[]) => actions.reduce(navReducer, s);
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function line(basePly = 2) {
  return { basePly, startFen: START, moves: playLine(START, ["e4", "e5", "Nf3"]) };
}

describe("game navigation", () => {
  it("steps and clamps at both ends", () => {
    const s = initNav(3);
    expect(run(s, { type: "prev" }).ply).toBe(0);
    expect(run(s, { type: "next" }, { type: "next" }).ply).toBe(2);
    expect(run(s, { type: "next" }, { type: "next" }, { type: "next" }, { type: "next" }).ply)
      .toBe(3);
  });

  it("first, last and goto", () => {
    const s = initNav(10, 4);
    expect(run(s, { type: "first" }).ply).toBe(0);
    expect(run(s, { type: "last" }).ply).toBe(10);
    expect(run(s, { type: "goto", ply: 7 }).ply).toBe(7);
    expect(run(s, { type: "goto", ply: 99 }).ply).toBe(10);
    expect(run(s, { type: "goto", ply: -3 }).ply).toBe(0);
  });

  it("exitLine without a line does nothing", () => {
    const s = initNav(5, 2);
    expect(run(s, { type: "exitLine" })).toBe(s);
  });
});

describe("best-line mode", () => {
  it("autoplay starts on the first line move and remembers where to return", () => {
    const s = run(initNav(10, 6), { type: "startLine", line: line(5), autoplay: true });
    expect(s.line?.idx).toBe(1);
    expect(s.line?.returnPly).toBe(6);
    expect(s.ply).toBe(6);
  });

  it("next/prev move inside the line, clamped at its end", () => {
    let s = run(initNav(10, 6), { type: "startLine", line: line() });
    s = run(s, { type: "next" }, { type: "next" }, { type: "next" }, { type: "next" });
    expect(s.line?.idx).toBe(3);
    s = run(s, { type: "prev" });
    expect(s.line?.idx).toBe(2);
    s = run(s, { type: "first" });
    expect(s.line?.idx).toBe(0);
    s = run(s, { type: "last" });
    expect(s.line?.idx).toBe(3);
  });

  it("prev at the start of the line returns to the game", () => {
    const s = run(initNav(10, 6), { type: "startLine", line: line() }, { type: "prev" });
    expect(s.line).toBeNull();
    expect(s.ply).toBe(6);
  });

  it("exitLine and goto leave the line", () => {
    const base = run(initNav(10, 6), { type: "startLine", line: line(), autoplay: true });
    expect(run(base, { type: "exitLine" })).toMatchObject({ ply: 6, line: null });
    expect(run(base, { type: "goto", ply: 2 })).toMatchObject({ ply: 2, line: null });
  });

  it("starting a new line keeps the original return point", () => {
    const s = run(initNav(10, 6), { type: "startLine", line: line() },
                  { type: "startLine", line: line(1) });
    expect(s.line?.returnPly).toBe(6);
  });

  it("an empty line is ignored", () => {
    const s = initNav(5, 1);
    expect(run(s, { type: "startLine", line: { basePly: 0, startFen: START, moves: [] } }))
      .toBe(s);
  });
});

describe("keys", () => {
  it("maps arrows, home/end and escape", () => {
    expect(keyToAction("ArrowLeft")).toEqual({ type: "prev" });
    expect(keyToAction("ArrowRight")).toEqual({ type: "next" });
    expect(keyToAction("Home")).toEqual({ type: "first" });
    expect(keyToAction("End")).toEqual({ type: "last" });
    expect(keyToAction("Escape")).toEqual({ type: "exitLine" });
    expect(keyToAction("x")).toBeNull();
  });
});

describe("playLine", () => {
  it("plays SAN and flags captures and checks", () => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1";
    const moves = playLine(fen, ["Qxf7#"]);
    expect(moves[0]).toMatchObject({ from: "f3", to: "f7", capture: true, check: true });
  });

  it("stops at an illegal move", () => {
    expect(playLine(START, ["e4", "e4", "Nf3"]).map((m) => m.san)).toEqual(["e4"]);
  });
});
