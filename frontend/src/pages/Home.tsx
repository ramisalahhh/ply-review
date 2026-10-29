import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import EngineSettingsPicker from "../components/EngineSettingsPicker";
import { api } from "../lib/api";
import type { GameSummary } from "../lib/types";

const OUTCOME = {
  win: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  loss: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300",
  draw: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function loadUser(): string {
  try {
    return localStorage.getItem("username") ?? "";
  } catch {
    return "";
  }
}

export default function Home() {
  const navigate = useNavigate();
  const [username, setUsername] = useState(loadUser);
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pgn, setPgn] = useState("");
  const [showPgn, setShowPgn] = useState(false);

  async function load(name = username) {
    const u = name.trim();
    if (!u) return;
    setLoading(true);
    setError(null);
    try {
      setGames(await api.games(u));
      try {
        localStorage.setItem("username", u);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setGames(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (username) void load(username);
    // load the remembered user once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start(body: { username?: string; game?: string; pgn?: string }, key: string) {
    setStarting(key);
    setError(null);
    try {
      const s = await api.start(body);
      const me = body.username ? `?me=${encodeURIComponent(body.username)}` : "";
      navigate(s.status === "done" || !s.job_id ? `/review/${s.review_id}${me}`
                                                : `/analyze/${s.job_id}${me}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="card p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Review your games</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Enter a chess.com username to see recent games. Every move is checked with Stockfish,
          right here in your browser.
        </p>
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void load(); }}>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="chess.com username"
            aria-label="chess.com username"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm
                       outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30
                       dark:border-slate-700 dark:bg-slate-950"
          />
          <button className="btn-primary" disabled={loading || !username.trim()}>
            {loading ? "Loading…" : "Show games"}
          </button>
        </form>
        <div className="mt-4">
          <EngineSettingsPicker onChange={() => { if (games) void load(); }} />
        </div>
        <button className="mt-3 text-xs text-slate-500 underline-offset-2 hover:underline"
                onClick={() => setShowPgn((v) => !v)}>
          {showPgn ? "Hide PGN" : "Or paste a PGN"}
        </button>
        {showPgn && (
          <div className="mt-2 space-y-2">
            <textarea value={pgn} onChange={(e) => setPgn(e.target.value)} rows={5}
                      aria-label="PGN"
                      className="w-full rounded-lg border border-slate-300 bg-white p-2 font-mono
                                 text-xs dark:border-slate-700 dark:bg-slate-950"
                      placeholder="[Event ...]  1. e4 e5 2. Nf3 ..." />
            <button className="btn-primary" disabled={!pgn.trim() || starting !== null}
                    onClick={() => void start({ pgn }, "pgn")}>Review this PGN</button>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </section>

      {games && (
        <section className="card divide-y divide-slate-200 dark:divide-slate-800">
          {games.length === 0 && <p className="p-6 text-sm text-slate-500">No games found.</p>}
          {games.map((g) => (
            <button
              key={g.game_id}
              disabled={starting !== null}
              onClick={() =>
                g.review_id
                  ? navigate(`/review/${g.review_id}?me=${encodeURIComponent(username)}`)
                  : void start({ username, game: g.url }, g.game_id)
              }
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition
                         hover:bg-slate-50 disabled:opacity-60 dark:hover:bg-slate-800/60"
            >
              <span className={`h-3 w-3 shrink-0 rounded-sm border border-slate-400 ${
                g.my_color === "white" ? "bg-white" : "bg-slate-800"}`}
                    title={`You played ${g.my_color}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  vs {g.opponent}{" "}
                  <span className="font-normal text-slate-500">({g.opponent_rating ?? "?"})</span>
                </div>
                <div className="text-xs text-slate-500">
                  {new Date(g.date).toLocaleDateString(undefined, { dateStyle: "medium" })} ·{" "}
                  {g.time_control} {g.time_class}
                </div>
              </div>
              {g.review_id && (
                <span className="hidden rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700
                                 sm:inline dark:bg-brand-600/20 dark:text-brand-300">reviewed</span>
              )}
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${OUTCOME[g.outcome]}`}>
                {g.outcome}
              </span>
              <span className="w-16 text-right text-sm text-brand-600 dark:text-brand-300">
                {starting === g.game_id ? "…" : g.review_id ? "Open" : "Review"}
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
