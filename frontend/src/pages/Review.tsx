import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Board, { type BoardArrow } from "../components/Board";
import ClassIcon, { CLASS_META } from "../components/ClassIcon";
import EvalBar from "../components/EvalBar";
import EvalGraph from "../components/EvalGraph";
import MoveList from "../components/MoveList";
import SummaryPanel from "../components/SummaryPanel";
import { api } from "../lib/api";
import { fenAt, formatClock, formatEval, playLine, showBestArrow, soundKind,
         whiteEvalAt } from "../lib/chess";
import { initNav, keyToAction, navReducer } from "../lib/navigation";
import { playSound } from "../lib/sounds";
import type { Review } from "../lib/types";

const BEST_ARROW = "rgba(16, 185, 129, 0.85)";
const LINE_ARROW = "rgba(99, 102, 241, 0.85)";

function useStoredFlag(key: string, initial: boolean) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? initial : s === "1";
    } catch {
      return initial;
    }
  });
  const set = (next: boolean) => {
    setV(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  return [v, set] as const;
}

export default function ReviewPage() {
  const { reviewId = "" } = useParams();
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReview(null);
    api.review(reviewId).then(setReview, (e: Error) => setError(e.message));
  }, [reviewId]);

  if (error) {
    return <p className="text-rose-600">{error} · <Link className="underline" to="/">Home</Link></p>;
  }
  if (!review) return <p className="text-slate-500">Loading review…</p>;
  return <ReviewView review={review} />;
}

export function ReviewView({ review }: { review: Review }) {
  const [params] = useSearchParams();
  const me = (params.get("me") ?? localStorageUser()).toLowerCase();
  const myColor = review.black.username.toLowerCase() === me ? "black" : "white";
  const [orientation, setOrientation] = useState<"white" | "black">(myColor);
  const [nav, dispatch] = useReducer(navReducer, review.moves.length, (n) => initNav(n));
  const [muted, setMuted] = useStoredFlag("muted", false);
  const [tab, setTab] = useState<"moves" | "summary">("summary");

  const move = nav.ply > 0 ? review.moves[nav.ply - 1] : null;
  const line = nav.line;
  const lineMove = line && line.idx > 0 ? line.moves[line.idx - 1] : null;

  // keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f") {
        setOrientation((o) => (o === "white" ? "black" : "white"));
        return;
      }
      const a = keyToAction(e.key);
      if (a) {
        e.preventDefault();
        dispatch(a);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // sounds on every displayed move change
  const soundKey = line ? `l${line.basePly}-${line.idx}` : `p${nav.ply}`;
  const lastSound = useRef(soundKey);
  useEffect(() => {
    if (lastSound.current === soundKey) return;
    lastSound.current = soundKey;
    if (muted) return;
    const san = line ? lineMove?.san : move?.san;
    if (san) playSound(soundKind(san));
  }, [soundKey, muted, line, lineMove, move]);

  // what the board shows
  const view = useMemo(() => {
    if (line) {
      return {
        fen: line.idx === 0 ? line.startFen : line.moves[line.idx - 1].fen,
        lastMove: lineMove ? { from: lineMove.from, to: lineMove.to } : null,
        icon: null,
        arrows: [] as BoardArrow[],
      };
    }
    const arrows: BoardArrow[] = [];
    if (move && showBestArrow(move)) {
      arrows.push({ from: move.best_uci.slice(0, 2), to: move.best_uci.slice(2, 4),
                    color: BEST_ARROW });
    }
    const next = review.moves[nav.ply];
    if (!move && next) {
      arrows.push({ from: next.best_uci.slice(0, 2), to: next.best_uci.slice(2, 4),
                    color: LINE_ARROW });
    }
    return {
      fen: fenAt(review, nav.ply),
      lastMove: move ? { from: move.uci.slice(0, 2), to: move.uci.slice(2, 4) } : null,
      icon: move ? { square: move.uci.slice(2, 4), cls: move.classification } : null,
      arrows,
    };
  }, [line, lineMove, move, nav.ply, review]);

  function showBestLine() {
    // engine line from the position before the current move (or the start)
    const base = move ?? review.moves[0];
    if (!base) return;
    const basePly = base.ply - 1;
    const moves = playLine(base.fen_before, base.best_pv_san);
    dispatch({ type: "startLine", line: { basePly, startFen: base.fen_before, moves },
               autoplay: true });
  }

  // in an engine line, show the line's own evaluation (the best move's score)
  const lineBase = line ? review.moves[line.basePly] : null;
  const evalLabel = lineBase
    ? formatEval(lineBase.color === "white" ? lineBase.best_eval : flip(lineBase.best_eval))
    : formatEval(whiteEvalAt(review, nav.ply));
  const whiteWin = lineBase
    ? 100 * (lineBase.color === "white" ? lineBase.ep_best : 1 - lineBase.ep_best)
    : review.white_win[nav.ply] ?? 50;
  const top = orientation === "white" ? review.black : review.white;
  const bottom = orientation === "white" ? review.white : review.black;
  const clockFor = (color: "white" | "black") => {
    for (let i = nav.ply - 1; i >= 0; i--) {
      if (review.moves[i].color === color) return formatClock(review.moves[i].clock);
    }
    return "";
  };

  const controls = (
    <div className="flex items-center justify-center gap-1">
      <button className="btn-ghost" aria-label="First move" onClick={() => dispatch({ type: "first" })}>
        <Chevron d="M11 17l-5-5 5-5M18 17l-5-5 5-5" /></button>
      <button className="btn-ghost" aria-label="Previous move" onClick={() => dispatch({ type: "prev" })}>
        <Chevron d="M15 18l-6-6 6-6" /></button>
      <button className="btn-ghost" aria-label="Next move" onClick={() => dispatch({ type: "next" })}>
        <Chevron d="M9 18l6-6-6-6" /></button>
      <button className="btn-ghost" aria-label="Last move" onClick={() => dispatch({ type: "last" })}>
        <Chevron d="M13 17l5-5-5-5M6 17l5-5-5-5" /></button>
      <span className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-700" />
      <button className="btn-ghost" aria-label="Flip board" title="Flip board (f)"
              onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}>
        <Chevron d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></button>
      <button className="btn-ghost" aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => setMuted(!muted)}>
        <Chevron d={muted ? "M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"
                          : "M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"} />
      </button>
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* board column */}
      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-11rem))] space-y-2 lg:max-w-[680px]">
        <PlayerBar name={top.username} rating={top.rating} clock={clockFor(top.color)} />
        <div className="flex items-stretch gap-2">
          <EvalBar whiteWin={whiteWin} label={evalLabel} orientation={orientation} />
          <div className="min-w-0 flex-1">
            <Board fen={view.fen} orientation={orientation} lastMove={view.lastMove}
                   icon={view.icon} arrows={view.arrows}
                   highlight={line ? "rgba(129, 140, 248, 0.45)" : undefined} />
          </div>
        </div>
        <PlayerBar name={bottom.username} rating={bottom.rating} clock={clockFor(bottom.color)} />
        {controls}
        <EvalGraph whiteWin={review.white_win} moves={review.moves} currentPly={nav.ply}
                   onSelect={(ply) => dispatch({ type: "goto", ply })} />
      </div>

      {/* side panel */}
      <div className="space-y-3">
        <div className="card p-4">
          {line ? (
            <LineBanner line={line} onExit={() => dispatch({ type: "exitLine" })}
                        onStep={(d) => dispatch({ type: d > 0 ? "next" : "prev" })} />
          ) : move ? (
            <MoveBanner review={review} ply={nav.ply} onBestLine={showBestLine} />
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-slate-500">Start position. Use ← → or the buttons to step through
                the game.</p>
              <button className="btn-ghost -ml-3" onClick={() => dispatch({ type: "next" })}>
                Start review →</button>
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex border-b border-slate-200 dark:border-slate-800" role="tablist">
            {(["summary", "moves"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                      className={`flex-1 py-2.5 text-sm font-medium capitalize transition ${
                        tab === t ? "border-b-2 border-brand-600 text-brand-700 dark:text-brand-300"
                                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="max-h-[28rem] overflow-y-auto p-3 lg:max-h-[calc(100dvh-20rem)]">
            {tab === "summary" ? (
              <SummaryPanel review={review} onJump={(ply) => {
                dispatch({ type: "goto", ply });
                setTab("moves");
              }} />
            ) : (
              <MoveList moves={review.moves} currentPly={line ? line.returnPly : nav.ply}
                        onSelect={(ply) => dispatch({ type: "goto", ply })} />
            )}
          </div>
        </div>
        {review.game.url && (
          <p className="text-center text-xs text-slate-400">
            <a className="hover:underline" href={review.game.url} target="_blank"
               rel="noreferrer">Game on chess.com ↗</a>
          </p>
        )}
      </div>
    </div>
  );
}

function localStorageUser(): string {
  try {
    return localStorage.getItem("username") ?? "";
  } catch {
    return "";
  }
}

function Chevron({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  );
}

function PlayerBar({ name, rating, clock }: { name: string; rating: number | null;
                                              clock: string }) {
  return (
    <div className="flex items-center justify-between px-1 text-sm">
      <span className="font-medium">{name} <span className="font-normal text-slate-500">
        ({rating ?? "?"})</span></span>
      {clock && <span className="rounded bg-slate-200 px-2 py-0.5 font-mono text-xs
                                 tabular-nums dark:bg-slate-800">{clock}</span>}
    </div>
  );
}

function MoveBanner({ review, ply, onBestLine }: { review: Review; ply: number;
                                                    onBestLine: () => void }) {
  const m = review.moves[ply - 1];
  const meta = CLASS_META[m.classification];
  const num = `${m.move_number}${m.color === "white" ? "." : "..."}`;
  const better = m.uci !== m.best_uci && m.classification !== "book";
  return (
    <div className="space-y-2" data-testid="move-banner">
      <div className="flex items-center gap-2">
        <ClassIcon cls={m.classification} size={26} />
        <p className="text-base font-semibold">
          {num} {m.san} <span style={{ color: meta.color }}>is {
            /^[aeiou]/i.test(meta.label) ? "an" : "a"} {meta.label.toLowerCase()} move</span>
        </p>
      </div>
      {better && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Best was <span className="font-semibold">{m.best_san}</span>
          <span className="text-slate-400"> ({formatEval(
            m.color === "white" ? m.best_eval : flip(m.best_eval))})</span>
        </p>
      )}
      {m.classification === "brilliant" && m.sacrifice > 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Gives up {m.sacrifice} point{m.sacrifice === 1 ? "" : "s"} of material.
        </p>
      )}
      {m.best_pv_san.length > 0 && (
        <button className="btn-ghost -ml-3 text-brand-700 dark:text-brand-300" onClick={onBestLine}>
          ▶ Show best line
          <span className="hidden truncate font-normal text-slate-400 sm:inline">
            {m.best_pv_san.slice(0, 4).join(" ")}
          </span>
        </button>
      )}
    </div>
  );
}

function LineBanner({ line, onExit, onStep }: {
  line: NonNullable<ReturnType<typeof navReducer>["line"]>;
  onExit: () => void;
  onStep: (d: number) => void;
}) {
  return (
    <div className="space-y-2" data-testid="line-banner">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">Engine line</p>
        <button className="btn-ghost text-xs" onClick={onExit}>Back to game (Esc)</button>
      </div>
      <p className="flex flex-wrap gap-x-1.5 font-mono text-sm">
        {line.moves.map((m, i) => (
          <span key={i} className={i + 1 === line.idx
            ? "rounded bg-brand-600 px-1 text-white" : "px-1 text-slate-500"}>{m.san}</span>
        ))}
      </p>
      <div className="flex gap-1">
        <button className="btn-ghost" onClick={() => onStep(-1)}>← Back</button>
        <button className="btn-ghost" onClick={() => onStep(1)}
                disabled={line.idx >= line.moves.length}>Next →</button>
      </div>
    </div>
  );
}

function flip(e: { cp: number | null; mate: number | null }) {
  return e.mate !== null ? { cp: null, mate: e.mate === 0 ? 1 : -e.mate }
                         : { cp: -(e.cp ?? 0), mate: null };
}
