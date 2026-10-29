// Several single-threaded Stockfish workers searching different positions at
// once. This gives multi-core speed without the cross-origin isolation headers
// that multi-threaded WASM needs (GitHub Pages cannot send them).
import type { PositionAnalysis, PositionJob, SearchLimits } from "./types";
import { AbortError, type EngineTransport, UciEngine } from "./uci";

export interface PoolProgress {
  done: number;
  total: number;
  index: number;            // which position just finished
  result: PositionAnalysis;
}

export class EnginePool {
  private engines: UciEngine[] = [];
  private starting: Promise<void> | null = null;

  constructor(
    private readonly makeTransport: () => EngineTransport,
    readonly size: number,
    private readonly options = { multipv: 2, hashMb: 16 },
  ) {}

  get engineName(): string {
    return this.engines[0]?.name ?? "Stockfish";
  }

  start(): Promise<void> {
    this.starting ??= (async () => {
      const engines = Array.from({ length: this.size }, () => new UciEngine(this.makeTransport()));
      await Promise.all(engines.map((e) => e.init(this.options)));
      this.engines = engines;
    })();
    return this.starting;
  }

  /** Analyse every position; results come back in input order. */
  async analyseAll(
    jobs: PositionJob[],
    limits: SearchLimits,
    onProgress?: (p: PoolProgress) => void,
    signal?: AbortSignal,
  ): Promise<PositionAnalysis[]> {
    await this.start();
    const results: PositionAnalysis[] = new Array(jobs.length);
    let next = 0;
    let done = 0;

    const report = (index: number, result: PositionAnalysis) => {
      results[index] = result;
      done++;
      onProgress?.({ done, total: jobs.length, index, result });
    };

    const run = async (engine: UciEngine) => {
      engine.newGame();
      while (next < jobs.length) {
        if (signal?.aborted) throw new AbortError();
        const index = next++;
        const job = jobs[index];
        if (job.terminal) {
          report(index, { fen: job.fen, depth: 0, lines: [], terminal: job.terminal });
          continue;
        }
        report(index, await engine.analyse(job.fen, limits, signal));
      }
    };

    await Promise.all(this.engines.map(run));
    return results;
  }

  terminate(): void {
    for (const e of this.engines) e.terminate();
    this.engines = [];
    this.starting = null;
  }
}
