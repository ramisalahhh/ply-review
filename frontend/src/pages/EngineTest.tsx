import { Chess } from "chess.js";
import { useEffect, useRef, useState } from "react";
import { formatEval } from "../lib/chess";
import { EnginePool } from "../engine/pool";
import { gamePositions } from "../engine/positions";
import { ENGINE_URL, limitsFor, loadSettings, maxWorkers, PRESETS, type Preset,
         saveSettings } from "../engine/settings";
import type { PositionAnalysis } from "../engine/types";
import { workerTransport } from "../engine/uci";

// A 40-ply Ruy Lopez: typical opening and middlegame positions.
const SAMPLE = ("e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 "
  + "c4 c6 cxb5 axb5 Nc3 Bb7 Bg5 b4 Nb1 h6 Bh4 c5 dxe5 Nxe4 Bxe7 Qxe7 exd6 Qf6 Nbd2 Nxd6")
  .split(" ");

interface Row {
  ply: number;
  fen: string;
  ms: number;
  result: PositionAnalysis;
}

function sanOf(fen: string, uci: string): string {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4),
                                  promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

export default function EngineTest() {
  const [settings, setSettings] = useState(loadSettings);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function run() {
    const jobs = gamePositions(SAMPLE);
    setRows([]);
    setSummary(null);
    setError(null);
    setRunning(true);
    const ac = new AbortController();
    abort.current = ac;
    const pool = new EnginePool(() => workerTransport(ENGINE_URL), settings.workers);
    const t0 = performance.now();
    try {
      await pool.start();
      const loadMs = performance.now() - t0;
      const started = new Map<number, number>();
      const t1 = performance.now();
      jobs.forEach((_, i) => started.set(i, t1));
      let last = t1;
      await pool.analyseAll(jobs, limitsFor(settings.preset), ({ index, result }) => {
        const now = performance.now();
        setRows((r) => [...r, { ply: index, fen: jobs[index].fen, ms: now - last, result }]
          .sort((a, b) => a.ply - b.ply));
        last = now;
      }, ac.signal);
      const total = (performance.now() - t1) / 1000;
      setSummary(`${pool.engineName}: ${jobs.length} positions in ${total.toFixed(1)} s `
        + `(${(total / jobs.length).toFixed(2)} s per position) with ${settings.workers} `
        + `worker${settings.workers > 1 ? "s" : ""}. Engine loaded in ${(loadMs / 1000).toFixed(1)} s.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pool.terminate();
      setRunning(false);
    }
  }

  function update(next: Partial<typeof settings>) {
    const s = { ...settings, ...next };
    setSettings(s);
    saveSettings(s);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="card space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">Engine test</h1>
          <p className="text-sm text-slate-500">
            Runs Stockfish in this browser on 41 positions of a sample game and measures speed.
            This device has {maxWorkers()} CPU threads.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Strength</span>
            <select value={settings.preset} disabled={running}
                    onChange={(e) => update({ preset: e.target.value as Preset })}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5
                               dark:border-slate-700 dark:bg-slate-950">
              {(Object.keys(PRESETS) as Preset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESETS[p].label} (depth {PRESETS[p].depth}, max {PRESETS[p].movetimeMs / 1000} s)
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">Workers</span>
            <input type="number" min={1} max={maxWorkers()} value={settings.workers}
                   disabled={running}
                   onChange={(e) => update({ workers: Math.max(1, Math.min(maxWorkers(),
                     Number(e.target.value) || 1)) })}
                   className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1.5
                              dark:border-slate-700 dark:bg-slate-950" />
          </label>
          {running ? (
            <button className="btn-ghost" onClick={() => abort.current?.abort()}>Stop</button>
          ) : (
            <button className="btn-primary" onClick={() => void run()}>Run test</button>
          )}
        </div>
        {running && (
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div className="h-full bg-brand-600 transition-[width]"
                 style={{ width: `${(100 * rows.length) / (SAMPLE.length + 1)}%` }} />
          </div>
        )}
        {summary && <p className="text-sm font-medium" data-testid="engine-summary">{summary}</p>}
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </section>

      {rows.length > 0 && (
        <section className="card overflow-x-auto p-2">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="p-2">Ply</th><th>Best</th><th>Eval</th><th>2nd line</th>
                <th>Depth</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [l1, l2] = r.result.lines;
                return (
                  <tr key={r.ply} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="p-2">{r.ply}</td>
                    <td>{l1 ? sanOf(r.fen, l1.move) : "–"}</td>
                    <td>{l1 ? formatEval(l1.eval) : formatEval(r.result.terminal)}</td>
                    <td className="text-slate-500">
                      {l2 ? `${sanOf(r.fen, l2.move)} ${formatEval(l2.eval)}` : "–"}
                    </td>
                    <td>{r.result.depth}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="p-2 text-xs text-slate-400">Evals are from the side to move.</p>
        </section>
      )}
    </div>
  );
}
