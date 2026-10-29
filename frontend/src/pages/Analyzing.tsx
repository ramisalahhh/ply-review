import { useEffect, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { BOARD_COLORS } from "../components/Board";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface Progress {
  done: number;
  total: number;
  fen: string;
  eval: string;
}

export default function Analyzing() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const { search } = useLocation();
  const [p, setP] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => api.subscribe(jobId, (e) => {
    if (e.type === "progress") setP(e);
    else if (e.type === "done") navigate(`/review/${e.review_id}${search}`, { replace: true });
    else if (e.type === "cancelled") setError("Analysis cancelled");
    else setError(e.error);
  }), [jobId, navigate, search]);

  // Phones pause background tabs and sleep the screen; keep it awake while analysing.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let released = false;
    const acquire = () => {
      navigator.wakeLock?.request("screen").then((l) => {
        if (released) void l.release();
        else lock = l;
      }, () => { /* not supported or refused: analysis still works */ });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !released) acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, []);

  const pct = p && p.total ? Math.round((100 * p.done) / p.total) : 0;

  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      <div className="card space-y-4 p-6">
        <h1 className="text-lg font-semibold">Analysing with Stockfish</h1>
        <p className="-mt-2 text-xs text-slate-500">Running in your browser. Keep this tab open.</p>
        <div className="mx-auto w-56">
          <Chessboard options={{
            id: "progress",
            position: p?.fen ?? START_FEN,
            allowDragging: false,
            showNotation: false,
            animationDurationInMs: 120,
            ...BOARD_COLORS,
          }} />
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
             role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
               style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-slate-500 tabular-nums">
          {p ? `Position ${p.done} of ${p.total} · eval ${p.eval}` : "Starting the engine…"}
        </p>
        {error ? (
          <p className="text-sm text-rose-600">{error} · <Link className="underline" to="/">Back</Link></p>
        ) : (
          <button className="btn-ghost" onClick={() => void api.cancel(jobId).then(() => navigate("/"))}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
