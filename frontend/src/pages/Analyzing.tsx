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

  useEffect(() => {
    const es = new EventSource(api.eventsUrl(jobId));
    es.addEventListener("progress", (e) => setP(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("done", (e) => {
      es.close();
      navigate(`/review/${JSON.parse((e as MessageEvent).data).review_id}${search}`, { replace: true });
    });
    for (const name of ["error", "cancelled"]) {
      es.addEventListener(name, (e) => {
        const data = (e as MessageEvent).data;
        if (!data) return; // a transport error; EventSource reconnects by itself
        es.close();
        setError(JSON.parse(data).error ?? `Analysis ${name}`);
      });
    }
    return () => es.close();
  }, [jobId, navigate, search]);

  const pct = p && p.total ? Math.round((100 * p.done) / p.total) : 0;

  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      <div className="card space-y-4 p-6">
        <h1 className="text-lg font-semibold">Analysing with Stockfish</h1>
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
