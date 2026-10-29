// Runs reviews entirely in the browser: Stockfish workers + the TypeScript
// analysis, with finished reviews saved on this device (IndexedDB).
import { CONFIG } from "../analysis/config";
import { loadBook, type OpeningBook } from "../analysis/opening";
import { evaluatePositions, parseGame } from "../analysis/pipeline";
import { buildReview, type GameMeta } from "../analysis/review";
import { flipped } from "../analysis/winprob";
import { EnginePool } from "../engine/pool";
import { ENGINE_URL, limitsFor, loadSettings, type EngineSettings, PRESETS } from "../engine/settings";
import { bestEval } from "../engine/types";
import { AbortError, workerTransport } from "../engine/uci";
import { formatEval } from "./chess";
import { ChessComClient } from "./chesscom";
import { formatTimeControl, gameId, resultTag, toSummary, type RawGame } from "./games";
import { kv } from "./idb";
import type { AnalysisStatus, GameSummary, Review } from "./types";

export type JobEvent =
  | { type: "progress"; done: number; total: number; fen: string; eval: string }
  | { type: "done"; review_id: string }
  | { type: "error"; error: string }
  | { type: "cancelled" };

interface Job {
  id: string;
  key: string;
  reviewId: string;
  status: AnalysisStatus["status"];
  done: number;
  total: number;
  error: string | null;
  history: JobEvent[];
  listeners: Set<(e: JobEvent) => void>;
  abort: AbortController;
}

/** 64-bit FNV-1a as 16 hex chars (stable ids, no crypto needed). */
export function hashId(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

const CONFIG_HASH = hashId(JSON.stringify(CONFIG));

export function reviewIdFor(key: string, preset: EngineSettings["preset"]): string {
  return hashId(`${key}|${preset}|${CONFIG_HASH}|v1`);
}

export function metaFor(g: RawGame): GameMeta {
  return {
    url: g.url,
    date: new Date((g.end_time ?? 0) * 1000).toISOString().slice(0, 10),
    result: resultTag(g),
    time_control: formatTimeControl(g.time_control),
  };
}

export interface ServiceDeps {
  client?: ChessComClient;
  makePool?: (workers: number) => EnginePool;
  book?: () => Promise<OpeningBook>;
  settings?: () => EngineSettings;
}

export class LocalAnalysis {
  readonly client: ChessComClient;
  private readonly makePool: (workers: number) => EnginePool;
  private readonly book: () => Promise<OpeningBook>;
  private readonly settings: () => EngineSettings;
  private jobs = new Map<string, Job>();
  private chain: Promise<unknown> = Promise.resolve(); // one analysis at a time

  constructor(deps: ServiceDeps = {}) {
    this.client = deps.client ?? new ChessComClient();
    this.makePool = deps.makePool ?? ((n) => new EnginePool(() => workerTransport(ENGINE_URL), n));
    this.book = deps.book ?? (() => loadBook());
    this.settings = deps.settings ?? loadSettings;
  }

  async games(username: string, limit = 30): Promise<GameSummary[]> {
    const games = await this.client.recentGames(username, limit);
    const preset = this.settings().preset;
    const reviewed = new Set(await kv().keys("reviews"));
    return games.map((g, i) => {
      const rid = reviewIdFor(gameId(g), preset);
      return toSummary(g, username, i + 1, reviewed.has(rid) ? rid : null);
    });
  }

  async review(id: string): Promise<Review> {
    const r = await kv().get<Review>("reviews", id);
    if (!r) throw new Error("This review is not saved on this device. Open it from your games list.");
    return r;
  }

  /** Start (or reuse) a review for a chess.com game or a pasted PGN. */
  async start(body: { username?: string; game?: string; pgn?: string }): Promise<AnalysisStatus> {
    let pgn: string;
    let key: string;
    let meta: GameMeta | undefined;
    if (body.pgn) {
      pgn = body.pgn;
      parseGame(pgn); // validate early
      key = `pgn/${hashId(pgn.trim())}`;
    } else if (body.username && body.game) {
      const g = await this.client.findGame(body.username, body.game);
      pgn = g.pgn ?? "";
      key = gameId(g);
      meta = metaFor(g);
    } else {
      throw new Error("Enter a username and pick a game, or paste a PGN.");
    }

    const settings = this.settings();
    const reviewId = reviewIdFor(key, settings.preset);
    if (await kv().get("reviews", reviewId)) {
      return { job_id: null, review_id: reviewId, status: "done", done: 0, total: 0, error: null };
    }
    for (const j of this.jobs.values()) {
      if (j.reviewId === reviewId && (j.status === "queued" || j.status === "running")) {
        return this.status(j);
      }
    }

    const job: Job = {
      id: hashId(`${reviewId}|${Date.now()}|${Math.random()}`), key, reviewId, status: "queued",
      done: 0, total: 0, error: null, history: [], listeners: new Set(),
      abort: new AbortController(),
    };
    this.jobs.set(job.id, job);
    const run = this.chain.then(() => this.run(job, pgn, settings, meta));
    this.chain = run.catch(() => undefined);
    return this.status(job);
  }

  private emit(job: Job, e: JobEvent) {
    job.history.push(e);
    for (const l of job.listeners) l(e);
  }

  private async run(job: Job, pgn: string, settings: EngineSettings, meta?: GameMeta) {
    if (job.abort.signal.aborted) {
      job.status = "cancelled";
      this.emit(job, { type: "cancelled" });
      return;
    }
    job.status = "running";
    const pool = this.makePool(settings.workers);
    try {
      const game = parseGame(pgn);
      const [book, positions] = await Promise.all([
        this.book(),
        evaluatePositions(game, pool, limitsFor(settings.preset), (p) => {
          job.done = p.done;
          job.total = p.total;
          const whiteToMove = p.result.fen.split(" ")[1] === "w";
          const e = bestEval(p.result);
          this.emit(job, { type: "progress", done: p.done, total: p.total, fen: p.result.fen,
                           eval: formatEval(whiteToMove ? e : flipped(e)) });
        }, job.abort.signal),
      ]);
      const review = buildReview(game, positions, {
        engine: pool.engineName, depth: PRESETS[settings.preset].depth, book, config: CONFIG,
        pgn, meta,
      });
      await kv().set("reviews", job.reviewId, review);
      job.status = "done";
      this.emit(job, { type: "done", review_id: job.reviewId });
    } catch (e) {
      if (e instanceof AbortError) {
        job.status = "cancelled";
        this.emit(job, { type: "cancelled" });
      } else {
        job.status = "error";
        job.error = (e as Error).message;
        this.emit(job, { type: "error", error: job.error });
      }
    } finally {
      pool.terminate();
    }
  }

  private status(j: Job): AnalysisStatus {
    return { job_id: j.id, review_id: j.reviewId, status: j.status, done: j.done,
             total: j.total, error: j.error };
  }

  /** Replays past events, then streams new ones. Returns an unsubscribe function. */
  subscribe(jobId: string, listener: (e: JobEvent) => void): () => void {
    const job = this.jobs.get(jobId);
    if (!job) {
      listener({ type: "error", error: "This analysis was interrupted (the page was reloaded). "
        + "Go back and start it again." });
      return () => {};
    }
    for (const e of job.history) listener(e);
    job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  cancel(jobId: string): void {
    this.jobs.get(jobId)?.abort.abort();
  }
}

export const local = new LocalAnalysis();
