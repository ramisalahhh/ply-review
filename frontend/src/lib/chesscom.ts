// chess.com Published-Data API from the browser (it allows cross-origin reads).
// Port of backend/fetch/client.py: one request at a time, retry with backoff on
// 429/5xx, and a local cache where past months never change.
import { gameId, gameIdFromUrl, isStandard, type RawGame } from "./games";
import { kv, type KvStore } from "./idb";

const API = "https://api.chess.com/pub";
const RETRY = new Set([429, 500, 502, 503, 504]);
const ARCHIVE_RE = /\/player\/([^/]+)\/games\/(\d{4})\/(\d{2})$/;

export class ChessComError extends Error {}
export class UserNotFound extends ChessComError {}
export class GameNotFound extends ChessComError {}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export interface ClientOptions {
  fetch?: typeof fetch;
  store?: KvStore;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  maxRetries?: number;
  archivesTtlMs?: number;
  currentMonthTtlMs?: number;
}

export class ChessComClient {
  private readonly fetch: typeof fetch;
  private readonly store: () => KvStore;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxRetries: number;
  private readonly archivesTtl: number;
  private readonly currentMonthTtl: number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(o: ClientOptions = {}) {
    this.fetch = o.fetch ?? ((...a) => globalThis.fetch(...a));
    this.store = o.store ? () => o.store! : kv;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
    this.maxRetries = o.maxRetries ?? 5;
    this.archivesTtl = o.archivesTtlMs ?? 60 * 60_000;
    this.currentMonthTtl = o.currentMonthTtlMs ?? 10 * 60_000;
  }

  /** chess.com asks for one request at a time; every call goes through this queue. */
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const run = this.queue.then(f);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private backoffMs(attempt: number, res: Response | null): number {
    const ra = res?.headers.get("Retry-After");
    if (ra && !Number.isNaN(Number(ra))) return Math.min(Number(ra) * 1000, 60_000);
    return Math.min(1000 * 2 ** attempt + Math.random() * 1000, 60_000);
  }

  private async request(url: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      try {
        res = await this.fetch(url, { headers: { Accept: "application/json" } });
        if (!RETRY.has(res.status)) return res;
        if (attempt >= this.maxRetries) {
          throw new ChessComError(`chess.com is busy (HTTP ${res.status}). Try again in a minute.`);
        }
      } catch (e) {
        if (e instanceof ChessComError) throw e;
        if (attempt >= this.maxRetries) {
          throw new ChessComError("Could not reach chess.com. Check your connection.");
        }
      }
      await this.sleep(this.backoffMs(attempt, res));
    }
  }

  /** Cached JSON. ttlMs = null: cached forever. */
  private async getJson<T>(url: string, key: string, ttlMs: number | null): Promise<T> {
    const cached = await this.store().get<CacheEntry<T>>("http", key);
    if (cached && (ttlMs === null || this.now() - cached.fetchedAt < ttlMs)) return cached.data;
    const res = await this.serial(() => this.request(url));
    if (res.status === 404) throw new UserNotFound("chess.com user not found");
    if (!res.ok) {
      if (cached) return cached.data; // stale beats nothing
      throw new ChessComError(`chess.com returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as T;
    await this.store().set("http", key, { data, fetchedAt: this.now() } satisfies CacheEntry<T>);
    return data;
  }

  async archives(username: string, refresh = false): Promise<string[]> {
    const u = username.trim().toLowerCase();
    const data = await this.getJson<{ archives?: string[] }>(
      `${API}/player/${encodeURIComponent(u)}/games/archives`, `${u}/archives`,
      refresh ? 0 : this.archivesTtl);
    return data.archives ?? [];
  }

  async monthGames(archiveUrl: string, refresh = false): Promise<RawGame[]> {
    const m = ARCHIVE_RE.exec(archiveUrl);
    if (!m) throw new ChessComError(`Unexpected archive URL: ${archiveUrl}`);
    const [, user, year, month] = m;
    const now = new Date(this.now());
    const isCurrent = Number(year) * 12 + Number(month)
      >= now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
    const ttl = refresh ? 0 : isCurrent ? this.currentMonthTtl : null;
    const data = await this.getJson<{ games?: RawGame[] }>(
      archiveUrl, `${user.toLowerCase()}/${year}-${month}`, ttl);
    return data.games ?? [];
  }

  /** Standard-chess games, newest first. */
  async recentGames(username: string, limit = 30, refresh = false): Promise<RawGame[]> {
    const out: RawGame[] = [];
    const archives = await this.archives(username, refresh);
    for (const url of [...archives].reverse()) {
      const games = (await this.monthGames(url, refresh)).filter(isStandard)
        .sort((a, b) => (b.end_time ?? 0) - (a.end_time ?? 0));
      for (const g of games) {
        out.push(g);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /** By 1-based index (1 = newest) or chess.com game URL. */
  async findGame(username: string, selector: string, maxMonths = 24): Promise<RawGame> {
    if (/^\d+$/.test(selector)) {
      const idx = Number(selector);
      const games = await this.recentGames(username, idx);
      if (idx < 1 || games.length < idx) throw new GameNotFound(`No game #${selector}`);
      return games[idx - 1];
    }
    const want = gameIdFromUrl(selector);
    if (!want) throw new GameNotFound(`Not a chess.com game link: ${selector}`);
    const archives = [...(await this.archives(username))].reverse().slice(0, maxMonths);
    for (const url of archives) {
      const g = (await this.monthGames(url)).find((x) => gameId(x) === want);
      if (g) return g;
    }
    throw new GameNotFound(`Game ${want} not found for ${username}`);
  }
}
