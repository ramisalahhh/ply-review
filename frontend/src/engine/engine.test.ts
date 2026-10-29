import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { EnginePool } from "./pool";
import { gamePositions, terminalEval } from "./positions";
import { AbortError, type EngineTransport, parseInfo, UciEngine } from "./uci";
import { Chess } from "chess.js";

const SCHOLAR = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
const LIMITS = { depth: 8, movetimeMs: 0, multipv: 2 };

describe("parseInfo", () => {
  it("reads depth, multipv, cp score and pv", () => {
    const i = parseInfo("info depth 12 seldepth 19 multipv 2 score cp -251 nodes 6244 nps 208133 "
      + "hashfull 2 time 30 pv h5e2 c6d4 e2d1");
    expect(i).toEqual({ depth: 12, multipv: 2, score: { cp: -251, mate: null }, bound: false,
                        pv: ["h5e2", "c6d4", "e2d1"] });
  });

  it("reads mate scores and bounds", () => {
    expect(parseInfo("info depth 3 multipv 1 score mate -2 pv a1a2")?.score)
      .toEqual({ cp: null, mate: -2 });
    expect(parseInfo("info depth 9 multipv 1 score cp 20 lowerbound nodes 1 pv e2e4")?.bound)
      .toBe(true);
  });

  it("defaults multipv to 1 and ignores lines without a pv", () => {
    expect(parseInfo("info depth 5 score cp 10 pv e2e4")?.multipv).toBe(1);
    expect(parseInfo("info depth 5 currmove e2e4 currmovenumber 1")).toBeNull();
    expect(parseInfo("info string NNUE evaluation using nn.nnue")).toBeNull();
  });
});

/** Scripted engine: answers every search with fixed lines, after a delay. */
function fakeTransport(log: string[], delayMs = 5): EngineTransport {
  let listener: (l: string) => void = () => {};
  let stopped = false;
  const reply = (l: string) => setTimeout(() => listener(l), 0);
  return {
    send(cmd) {
      log.push(cmd);
      if (cmd === "uci") {
        reply("id name FakeFish 1");
        reply("uciok");
      } else if (cmd === "isready") {
        reply("readyok");
      } else if (cmd === "stop") {
        stopped = true;
      } else if (cmd.startsWith("go")) {
        setTimeout(() => {
          if (!stopped) {
            listener("info depth 4 multipv 1 score cp 50 pv e2e4 e7e5");
            listener("info depth 4 multipv 2 score cp 30 pv d2d4");
            listener("info depth 3 multipv 1 score cp 99 upperbound pv a2a3");
          }
          listener("bestmove e2e4");
        }, delayMs);
      }
    },
    onLine(cb) {
      listener = cb;
    },
    terminate() {},
  };
}

describe("UciEngine", () => {
  it("initialises with MultiPV and parses a search", async () => {
    const log: string[] = [];
    const e = new UciEngine(fakeTransport(log));
    await e.init({ multipv: 2, hashMb: 16 });
    expect(e.name).toBe("FakeFish 1");
    expect(log).toContain("setoption name MultiPV value 2");
    const pa = await e.analyse(SCHOLAR, { depth: 4, movetimeMs: 1000, multipv: 2 });
    expect(log).toContain("go depth 4 movetime 1000");
    expect(pa.lines.map((l) => [l.move, l.eval.cp])).toEqual([["e2e4", 50], ["d2d4", 30]]);
    expect(pa.depth).toBe(4);
  });

  it("queues searches on one engine", async () => {
    const log: string[] = [];
    const e = new UciEngine(fakeTransport(log));
    await e.init({ multipv: 2, hashMb: 16 });
    await Promise.all([e.analyse("8/8/8/8/8/8/8/K6k w - - 0 1", LIMITS),
                       e.analyse(SCHOLAR, LIMITS)]);
    const gos = log.map((c, i) => [c, i] as const).filter(([c]) => c.startsWith("go"));
    const positions = log.map((c, i) => [c, i] as const).filter(([c]) => c.startsWith("position"));
    expect(positions[1][1]).toBeGreaterThan(gos[0][1]); // 2nd position sent after 1st search
  });

  it("stops and rejects when aborted", async () => {
    const log: string[] = [];
    const e = new UciEngine(fakeTransport(log, 50));
    await e.init({ multipv: 2, hashMb: 16 });
    const ac = new AbortController();
    const p = e.analyse(SCHOLAR, LIMITS, ac.signal);
    setTimeout(() => ac.abort(), 5);
    await expect(p).rejects.toBeInstanceOf(AbortError);
    expect(log).toContain("stop");
  });
});

describe("EnginePool", () => {
  it("analyses in parallel and returns results in input order", async () => {
    const logs: string[][] = [];
    const pool = new EnginePool(() => {
      const log: string[] = [];
      logs.push(log);
      return fakeTransport(log, 10);
    }, 3);
    const jobs = gamePositions(["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]);
    const seen: number[] = [];
    const results = await pool.analyseAll(jobs, LIMITS, (p) => seen.push(p.done));
    expect(results).toHaveLength(8);
    expect(results.map((r) => r.fen)).toEqual(jobs.map((j) => j.fen));
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(results[7].terminal).toEqual({ cp: null, mate: 0 }); // checkmate, not searched
    const searches = logs.map((l) => l.filter((c) => c.startsWith("go")).length);
    expect(searches).toHaveLength(3);
    expect(searches.reduce((a, b) => a + b)).toBe(7);
    expect(Math.min(...searches)).toBeGreaterThan(0); // every worker did some work
  });

  it("aborts the whole run", async () => {
    const pool = new EnginePool(() => fakeTransport([], 30), 2);
    const ac = new AbortController();
    const run = pool.analyseAll(gamePositions(["e4", "e5", "Nf3", "Nc6"]), LIMITS, undefined,
                                ac.signal);
    setTimeout(() => ac.abort(), 10);
    await expect(run).rejects.toBeInstanceOf(AbortError);
  });
});

describe("terminal positions", () => {
  it("detects mate, stalemate and repetition", () => {
    expect(terminalEval(new Chess(
      "r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4")))
      .toEqual({ cp: null, mate: 0 });
    expect(terminalEval(new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"))).toEqual({ cp: 0, mate: null });
    const rep = gamePositions(["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]);
    expect(rep[8].terminal).toEqual({ cp: 0, mate: null });
    expect(rep[4].terminal).toBeNull();
  });
});

// --- the real WASM engine, run in Node ----------------------------------------

function nodeTransport(): EngineTransport {
  const require = createRequire(import.meta.url);
  const init = require("stockfish") as (kind: string, cb: (l: string) => void) => {
    processCommand(c: string): void;
    terminate(): void;
  };
  let listener: (l: string) => void = () => {};
  const engine = init("lite-single", (l) => listener(l));
  return {
    send: (c) => engine.processCommand(c),
    onLine: (cb) => {
      listener = cb;
    },
    terminate: () => engine.terminate(),
  };
}

describe("real Stockfish (WASM)", () => {
  it("finds mate in one with two lines", async () => {
    const t = nodeTransport();
    await new Promise((r) => setTimeout(r, 800)); // let the WASM module load
    const e = new UciEngine(t);
    await e.init({ multipv: 2, hashMb: 16 });
    expect(e.name).toMatch(/Stockfish 19/);
    const pa = await e.analyse(SCHOLAR, LIMITS);
    expect(pa.lines[0]).toMatchObject({ move: "h5f7", eval: { cp: null, mate: 1 } });
    expect(pa.lines).toHaveLength(2);
    e.terminate();
  }, 60_000);
});
