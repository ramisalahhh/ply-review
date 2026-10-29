import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bookFromJson } from "../analysis/opening";
import { EnginePool } from "../engine/pool";
import type { EngineTransport } from "../engine/uci";
import { ChessComClient } from "./chesscom";
import { memoryStore, setKv } from "./idb";
import { hashId, type JobEvent, LocalAnalysis } from "./local";

const PGN = '[Event "Live Chess"]\n[White "ramisalahh"]\n[Black "opp"]\n[Result "1-0"]\n\n'
  + "1. e4 {[%clk 0:09:58]} 1... e5 {[%clk 0:09:57]} 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n";
const GAME = {
  url: "https://www.chess.com/game/live/42", pgn: PGN, end_time: 1_760_000_000,
  time_control: "600", time_class: "rapid", rules: "chess",
  white: { username: "ramisalahh", rating: 400, result: "win" },
  black: { username: "opp", rating: 410, result: "checkmated" },
};
const book = bookFromJson(JSON.parse(readFileSync("public/data/book.json", "utf8")));

/** Engine that always answers the same two lines (legal moves get used by SAN). */
function scriptedTransport(gate?: Promise<void>): EngineTransport {
  let cb: (l: string) => void = () => {};
  return {
    send(c) {
      const reply = (l: string) => setTimeout(() => cb(l), 0);
      if (c === "uci") { reply("id name FakeFish"); reply("uciok"); }
      else if (c === "isready") reply("readyok");
      else if (c.startsWith("go")) {
        void (gate ?? Promise.resolve()).then(() => {
          cb("info depth 10 multipv 1 score cp 30 pv e2e4");
          cb("info depth 10 multipv 2 score cp 20 pv d2d4");
          cb("bestmove e2e4");
        });
      }
    },
    onLine: (f) => { cb = f; },
    terminate() {},
  };
}

function service(opts: { gate?: Promise<void> } = {}) {
  const pools: number[] = [];
  const fetchStub = (async (u: RequestInfo | URL) => {
    const url = String(u);
    if (url.endsWith("/archives")) {
      return new Response(JSON.stringify({ archives: [
        "https://api.chess.com/pub/player/ramisalahh/games/2025/10"] }));
    }
    return new Response(JSON.stringify({ games: [GAME] }));
  }) as typeof fetch;
  const svc = new LocalAnalysis({
    client: new ChessComClient({ fetch: fetchStub, store: memoryStore() }),
    makePool: (n) => {
      pools.push(n);
      return new EnginePool(() => scriptedTransport(opts.gate), n);
    },
    book: async () => book,
    settings: () => ({ preset: "fast", workers: 2 }),
  });
  return { svc, pools };
}

function collect(svc: LocalAnalysis, jobId: string): Promise<JobEvent[]> {
  return new Promise((resolve) => {
    const events: JobEvent[] = [];
    svc.subscribe(jobId, (e) => {
      events.push(e);
      if (e.type !== "progress") resolve(events);
    });
  });
}

beforeEach(() => setKv(memoryStore()));
afterEach(() => setKv(null));

describe("LocalAnalysis", () => {
  it("reviews a chess.com game in the browser and saves it", async () => {
    const { svc, pools } = service();
    const s = await svc.start({ username: "ramisalahh", game: GAME.url });
    expect(s.status).toBe("queued");
    const events = await collect(svc, s.job_id!);
    const progress = events.filter((e) => e.type === "progress");
    expect(progress).toHaveLength(8);
    expect(events.at(-1)).toEqual({ type: "done", review_id: s.review_id });
    expect(pools).toEqual([2]);

    const r = await svc.review(s.review_id);
    expect(r.moves.map((m) => m.san)).toEqual(["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]);
    expect(r.engine).toBe("FakeFish");
    expect(r.game).toMatchObject({ url: GAME.url, result: "1-0", time_control: "10 min" });
    expect(r.moves[0].clock).toBe(598);
    expect(r.opening).not.toBeNull();
  });

  it("does not analyse the same game twice", async () => {
    const { svc, pools } = service();
    const s = await svc.start({ username: "ramisalahh", game: "1" });
    await collect(svc, s.job_id!);
    const again = await svc.start({ username: "ramisalahh", game: GAME.url });
    expect(again).toMatchObject({ status: "done", job_id: null, review_id: s.review_id });
    expect(pools).toHaveLength(1);
    const games = await svc.games("ramisalahh");
    expect(games[0].review_id).toBe(s.review_id);
  });

  it("shares a running job and replays progress to late subscribers", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const { svc } = service({ gate });
    const a = await svc.start({ username: "ramisalahh", game: "1" });
    const b = await svc.start({ username: "ramisalahh", game: "1" });
    expect(b.job_id).toBe(a.job_id);
    open();
    await collect(svc, a.job_id!);
    const late = await collect(svc, a.job_id!);
    expect(late.filter((e) => e.type === "progress")).toHaveLength(8);
  });

  it("can be cancelled", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const { svc } = service({ gate });
    const s = await svc.start({ username: "ramisalahh", game: "1" });
    const done = collect(svc, s.job_id!);
    svc.cancel(s.job_id!);
    open();
    expect((await done).at(-1)).toEqual({ type: "cancelled" });
    await expect(svc.review(s.review_id)).rejects.toThrow(/not saved/);
  });

  it("reviews a pasted PGN", async () => {
    const { svc } = service();
    const s = await svc.start({ pgn: PGN });
    expect((await collect(svc, s.job_id!)).at(-1)?.type).toBe("done");
    expect((await svc.review(s.review_id)).white.username).toBe("ramisalahh");
  });

  it("rejects bad input and explains a reloaded page", async () => {
    const { svc } = service();
    await expect(svc.start({ pgn: "1. e4 e5 2. Ke3" })).rejects.toThrow();
    await expect(svc.start({})).rejects.toThrow(/username/);
    const events: JobEvent[] = [];
    svc.subscribe("gone", (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: "error" });
  });

  it("hashId is stable and 16 hex chars", () => {
    expect(hashId("abc")).toBe(hashId("abc"));
    expect(hashId("abc")).not.toBe(hashId("abd"));
    expect(hashId("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});
