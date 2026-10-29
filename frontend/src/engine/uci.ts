// Minimal UCI client for Stockfish running in a Web Worker (or in Node for tests).
import type { Eval, Line, PositionAnalysis, SearchLimits } from "./types";

export interface EngineTransport {
  send(command: string): void;
  onLine(listener: (line: string) => void): void;
  terminate(): void;
}

export class AbortError extends Error {
  constructor() {
    super("Analysis cancelled");
    this.name = "AbortError";
  }
}

export interface InfoLine {
  depth: number;
  multipv: number;
  score: Eval;
  bound: boolean; // lowerbound/upperbound: not a final score
  pv: string[];
}

/** Parse "info depth 12 ... multipv 1 score cp 34 ... pv e2e4 e7e5". */
export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith("info ") || !line.includes(" pv ") || !line.includes(" score ")) {
    return null;
  }
  const t = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let score: Eval | null = null;
  let bound = false;
  let pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case "depth":
        depth = Number(t[++i]);
        break;
      case "multipv":
        multipv = Number(t[++i]);
        break;
      case "score": {
        const kind = t[++i];
        const v = Number(t[++i]);
        score = kind === "mate" ? { cp: null, mate: v } : { cp: v, mate: null };
        if (t[i + 1] === "lowerbound" || t[i + 1] === "upperbound") {
          bound = true;
          i++;
        }
        break;
      }
      case "pv":
        pv = t.slice(i + 1);
        i = t.length;
        break;
    }
  }
  if (!score || pv.length === 0) return null;
  return { depth, multipv, score, bound, pv };
}

export class UciEngine {
  name = "Stockfish";
  private listeners = new Set<(line: string) => void>();
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private readonly transport: EngineTransport) {
    transport.onLine((line) => {
      for (const l of this.listeners) l(line);
    });
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs = 30_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error("Engine did not respond"));
      }, timeoutMs);
      const listener = (line: string) => {
        if (predicate(line)) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(line);
        }
      };
      this.listeners.add(listener);
    });
  }

  async init(options: { multipv: number; hashMb: number }): Promise<void> {
    const nameListener = (line: string) => {
      if (line.startsWith("id name ")) this.name = line.slice(8).trim();
    };
    this.listeners.add(nameListener);
    const ok = this.waitFor((l) => l === "uciok", 60_000);
    this.transport.send("uci");
    await ok;
    this.listeners.delete(nameListener);
    this.transport.send(`setoption name MultiPV value ${options.multipv}`);
    this.transport.send(`setoption name Hash value ${options.hashMb}`);
    await this.ready();
  }

  async ready(): Promise<void> {
    const ok = this.waitFor((l) => l === "readyok");
    this.transport.send("isready");
    await ok;
  }

  newGame(): void {
    this.transport.send("ucinewgame");
  }

  /** Search one position. Calls are queued, so one engine never runs two searches. */
  analyse(fen: string, limits: SearchLimits, signal?: AbortSignal): Promise<PositionAnalysis> {
    const run = this.busy.then(() => this.search(fen, limits, signal));
    this.busy = run.catch(() => undefined);
    return run;
  }

  private async search(fen: string, limits: SearchLimits, signal?: AbortSignal) {
    if (signal?.aborted) throw new AbortError();
    const best = new Map<number, InfoLine>();
    const onInfo = (line: string) => {
      const info = parseInfo(line);
      if (!info || info.bound || info.multipv > limits.multipv) return;
      best.set(info.multipv, info);
    };
    this.listeners.add(onInfo);
    const onAbort = () => this.transport.send("stop");
    signal?.addEventListener("abort", onAbort);
    try {
      const done = this.waitFor((l) => l.startsWith("bestmove"), 10 * 60_000);
      this.transport.send(`position fen ${fen}`);
      const time = limits.movetimeMs > 0 ? ` movetime ${limits.movetimeMs}` : "";
      this.transport.send(`go depth ${limits.depth}${time}`);
      await done;
    } finally {
      this.listeners.delete(onInfo);
      signal?.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted) throw new AbortError();

    const infos = [...best.values()].sort((a, b) => a.multipv - b.multipv);
    if (infos.length === 0) throw new Error(`Engine returned no lines for ${fen}`);
    const lines: Line[] = infos.map((i) => ({ move: i.pv[0], eval: i.score, pv: i.pv }));
    return { fen, depth: Math.min(...infos.map((i) => i.depth)), lines, terminal: null };
  }

  terminate(): void {
    this.transport.terminate();
  }
}

/** Transport for the browser: the engine runs in a Web Worker. */
export function workerTransport(url: string): EngineTransport {
  const worker = new Worker(url);
  return {
    send: (c) => worker.postMessage(c),
    onLine: (cb) => {
      worker.onmessage = (e: MessageEvent) => {
        const data = String(e.data);
        for (const line of data.split("\n")) if (line) cb(line);
      };
    },
    terminate: () => worker.terminate(),
  };
}
