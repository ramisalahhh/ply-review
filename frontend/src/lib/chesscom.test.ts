import { describe, expect, it } from "vitest";
import { ChessComClient, ChessComError, GameNotFound, UserNotFound } from "./chesscom";
import { formatTimeControl, gameIdFromUrl, outcomeFor, toSummary, type RawGame } from "./games";
import { memoryStore } from "./idb";

const PGN = '[Event "Live Chess"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n';
const API = "https://api.chess.com/pub/player/ramisalahh/games";
const M1 = `${API}/2024/01`;
const M2 = `${API}/2024/02`;
const NOW = Date.UTC(2026, 9, 29);

function game(id: number, end: number, extra: Partial<RawGame> = {}): RawGame {
  return {
    url: `https://www.chess.com/game/live/${id}`, pgn: PGN, end_time: end, time_control: "600",
    time_class: "rapid", rules: "chess",
    white: { username: "ramisalahh", rating: 400, result: "win" },
    black: { username: "opp", rating: 410, result: "checkmated" }, ...extra,
  };
}

function fakeFetch(routes: Record<string, (() => Response)[] | (() => Response)>) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response("not found", { status: 404 });
    return Array.isArray(r) ? (r.length > 1 ? r.shift()! : r[0])() : r();
  }) as typeof fetch;
  return { f, calls };
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(data), { status, headers });

function twoMonths() {
  return {
    [`${API}/archives`]: json({ archives: [M1, M2] }),
    [M1]: json({ games: [game(1, 100), game(2, 200)] }),
    [M2]: json({ games: [game(3, 300), game(4, 400, { rules: "chess960" }),
                         game(5, 500, { white: { username: "opp", result: "resigned" },
                                        black: { username: "RamiSalahh", result: "win" } })] }),
  };
}

type Routes = Record<string, (() => Response)[] | (() => Response)>;

function client(routes: Routes, sleeps: number[] = []) {
  const { f, calls } = fakeFetch(routes);
  const c = new ChessComClient({ fetch: f, store: memoryStore(), now: () => NOW, maxRetries: 3,
                                 sleep: async (ms) => { sleeps.push(ms); } });
  return { c, calls };
}

describe("ChessComClient (browser)", () => {
  it("lists standard games newest first", async () => {
    const { c } = client(twoMonths());
    const games = await c.recentGames("RamiSalahh", 10);
    expect(games.map((g) => g.url.split("/").pop())).toEqual(["5", "3", "2", "1"]);
    expect(outcomeFor(games[0], "ramisalahh")).toBe("win");
  });

  it("stops before older months once it has enough", async () => {
    const { c, calls } = client(twoMonths());
    await c.recentGames("ramisalahh", 2);
    expect(calls).not.toContain(M1);
  });

  it("caches past months forever and refreshes the archive list", async () => {
    const { c, calls } = client(twoMonths());
    await c.recentGames("ramisalahh", 10);
    await c.recentGames("ramisalahh", 10, true);
    expect(calls.filter((u) => u === M1)).toHaveLength(2); // refresh=true refetches
    const { c: c2, calls: calls2 } = client(twoMonths());
    await c2.recentGames("ramisalahh", 10);
    await c2.recentGames("ramisalahh", 10);
    expect(calls2.filter((u) => u === M1)).toHaveLength(1);
  });

  it("retries 429 with Retry-After, then gives up", async () => {
    const sleeps: number[] = [];
    const { c } = client({ ...twoMonths(), [`${API}/archives`]: [
      json({}, 429, { "Retry-After": "7" }), json({}, 503), json({ archives: [] })] }, sleeps);
    expect(await c.archives("ramisalahh")).toEqual([]);
    expect(sleeps[0]).toBe(7000);
    expect(sleeps[1]).toBeGreaterThanOrEqual(2000);

    const { c: busy } = client({ ...twoMonths(), [`${API}/archives`]: json({}, 429) });
    await expect(busy.archives("ramisalahh")).rejects.toBeInstanceOf(ChessComError);
  });

  it("reports unknown users", async () => {
    const { c } = client(twoMonths());
    await expect(c.archives("nobody")).rejects.toBeInstanceOf(UserNotFound);
  });

  it("finds a game by index or link", async () => {
    const { c } = client(twoMonths());
    expect((await c.findGame("ramisalahh", "2")).url).toMatch(/\/3$/);
    expect((await c.findGame("ramisalahh", "https://www.chess.com/game/live/1?move=3")).url)
      .toMatch(/\/1$/);
    await expect(c.findGame("ramisalahh", "https://www.chess.com/game/live/999"))
      .rejects.toBeInstanceOf(GameNotFound);
    await expect(c.findGame("ramisalahh", "99")).rejects.toBeInstanceOf(GameNotFound);
  });

  it("makes one request at a time", async () => {
    let active = 0;
    let peak = 0;
    const routes = twoMonths();
    const f = (async (u: RequestInfo | URL) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return (routes[String(u) as keyof typeof routes] as () => Response)();
    }) as typeof fetch;
    const c = new ChessComClient({ fetch: f, store: memoryStore(), now: () => NOW });
    await Promise.all([c.monthGames(M1), c.monthGames(M2), c.archives("ramisalahh")]);
    expect(peak).toBe(1);
  });
});

describe("game helpers (same as the Python models)", () => {
  it.each([
    ["600", "10 min"], ["180+2", "3|2"], ["60", "1 min"], ["30", "0.5 min"],
    ["1/86400", "1 day"], ["1/259200", "3 days"], ["900+10", "15|10"],
  ])("time control %s -> %s", (tc, label) => {
    expect(formatTimeControl(tc)).toBe(label);
  });

  it.each([
    ["https://www.chess.com/game/live/123", "live/123"],
    ["https://www.chess.com/live/game/123", "live/123"],
    ["https://www.chess.com/game/daily/77#move", "daily/77"],
    ["https://example.com/x", null],
  ])("game id %s", (url, id) => {
    expect(gameIdFromUrl(url)).toBe(id);
  });

  it("summarises a game from the player's side", () => {
    const s = toSummary(game(9, 1_700_000_000, {
      white: { username: "opp", rating: 500, result: "agreed" },
      black: { username: "ramisalahh", rating: 400, result: "agreed" } }), "ramisalahh", 1, null);
    expect(s).toMatchObject({ my_color: "black", outcome: "draw", opponent: "opp",
                              opponent_rating: 500, result: "1/2-1/2", game_id: "live/9" });
  });
});
