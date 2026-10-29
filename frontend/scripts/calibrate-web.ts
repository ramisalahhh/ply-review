// Analyse the calibration games with exactly the website's engine and code.
//
//   npx tsx scripts/calibrate-web.ts [dataset.jsonl] [results.jsonl] [--workers 6] [--preset normal]
//
// Runs several Node processes, each with its own Stockfish Lite (WASM), and
// appends one line per game to the results file (finished games are skipped
// on a re-run). scripts/fit_accuracy.py then compares the results with chess.com.
import { fork } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus } from "node:os";
import { CONFIG } from "../src/analysis/config";
import { bookFromJson } from "../src/analysis/opening";
import { evaluatePositions, parseGame } from "../src/analysis/pipeline";
import { buildReview } from "../src/analysis/review";
import { EnginePool } from "../src/engine/pool";
import { limitsFor, PRESETS, type Preset } from "../src/engine/settings";
import type { EngineTransport } from "../src/engine/uci";

interface Row {
  url: string;
  pgn: string;
  white_rating: number;
  black_rating: number;
  api_white: number;
  api_black: number;
  time_class: string;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** Stockfish WASM in this Node process. Commands wait until the module has loaded. */
function nodeTransport(): EngineTransport {
  const require = createRequire(import.meta.url);
  const init = require("stockfish") as (kind: string, cb: (l: string) => void) => {
    processCommand(c: string): void;
    terminate(): void;
  };
  let listener: (l: string) => void = () => {};
  let ready = false;
  const queued: string[] = [];
  const engine = init("lite-single", (line) => {
    if (!ready && line === "readyok") {
      ready = true;
      for (const c of queued.splice(0)) engine.processCommand(c);
      return;
    }
    listener(line);
  });
  const poll = setInterval(() => {
    if (ready) clearInterval(poll);
    else engine.processCommand("isready");
  }, 200);
  return {
    send: (c) => (ready ? engine.processCommand(c) : queued.push(c)),
    onLine: (cb) => {
      listener = cb;
    },
    terminate: () => {
      clearInterval(poll);
      engine.terminate();
    },
  };
}

async function child() {
  const rows = JSON.parse(process.env.CALIB_ROWS ?? "[]") as Row[];
  const preset = (process.env.CALIB_PRESET ?? "normal") as Preset;
  const book = bookFromJson(JSON.parse(readFileSync("public/data/book.json", "utf8")));
  const pool = new EnginePool(nodeTransport, 1);
  for (const row of rows) {
    const t0 = Date.now();
    try {
      const game = parseGame(row.pgn);
      const positions = await evaluatePositions(game, pool, limitsFor(preset));
      const r = buildReview(game, positions, { engine: pool.engineName,
        depth: PRESETS[preset].depth, book, config: CONFIG, pgn: row.pgn });
      process.send!({ ok: true, row: {
        url: row.url, time_class: row.time_class, plies: r.moves.length, preset,
        white_rating: row.white_rating, black_rating: row.black_rating,
        api_white: row.api_white, api_black: row.api_black,
        ours_white: r.white.accuracy, ours_black: r.black.accuracy,
        counts_white: r.white.counts, counts_black: r.black.counts,
        // per-move data, so accuracy formulas can be fitted offline without the engine
        white_win: r.white_win.map((v) => Math.round(v * 1000) / 1000),
        moves: r.moves.map((m) => [m.color[0], Math.round(m.ep_best * 1e5) / 1e5,
          Math.round(m.ep_played * 1e5) / 1e5, m.classification]),
        seconds: (Date.now() - t0) / 1000,
      } });
    } catch (e) {
      process.send!({ ok: false, url: row.url, error: (e as Error).message });
    }
  }
  pool.terminate();
  process.exit(0);
}

async function main() {
  const dataset = process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2] : "../calibration/dataset.jsonl";
  const out = process.argv[3] && !process.argv[3].startsWith("--")
    ? process.argv[3] : "../calibration/results-web.jsonl";
  const workers = Number(arg("workers", String(Math.max(1, cpus().length - 2))));
  const preset = arg("preset", "normal");

  const done = new Set(existsSync(out)
    ? readFileSync(out, "utf8").split("\n").filter(Boolean)
        .map((l) => (JSON.parse(l) as { url: string; preset: string }))
        .filter((r) => r.preset === preset).map((r) => r.url)
    : []);
  const rows = readFileSync(dataset, "utf8").split("\n").filter(Boolean)
    .map((l) => JSON.parse(l) as Row).filter((r) => !done.has(r.url));
  console.log(`${rows.length} games to analyse (${done.size} already done), ${workers} workers, `
    + `preset ${preset}`);
  if (rows.length === 0) return;

  const chunks: Row[][] = Array.from({ length: Math.min(workers, rows.length) }, () => []);
  rows.forEach((r, i) => chunks[i % chunks.length].push(r));
  const started = Date.now();
  let finished = 0;
  await Promise.all(chunks.map((chunk) => new Promise<void>((resolve) => {
    const p = fork(process.argv[1], ["--child"], {
      env: { ...process.env, CALIB_ROWS: JSON.stringify(chunk), CALIB_PRESET: preset },
    });
    p.on("message", (m: { ok: boolean; row?: { url: string; seconds: number }; url?: string;
                          error?: string }) => {
      finished++;
      const elapsed = ((Date.now() - started) / 60000).toFixed(1);
      if (m.ok && m.row) {
        appendFileSync(out, JSON.stringify(m.row) + "\n");
        console.log(`[${finished}/${rows.length}] ${elapsed} min  ${m.row.url.split("/").pop()}`
          + `  (${m.row.seconds.toFixed(0)} s)`);
      } else {
        console.log(`[${finished}/${rows.length}] FAILED ${m.url}: ${m.error}`);
      }
    });
    p.on("exit", () => resolve());
  })));
  console.log(`Done in ${((Date.now() - started) / 60000).toFixed(1)} min -> ${out}`);
}

if (process.argv.includes("--child")) void child();
else void main();
