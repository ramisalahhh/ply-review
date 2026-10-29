import type { Review } from "../lib/types";
import { CLASS_ORDER } from "../lib/types";
import ClassIcon, { CLASS_META } from "./ClassIcon";

function Player({ name, rating, accuracy, color }: {
  name: string; rating: number | null; accuracy: number | null; color: "white" | "black";
}) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className={`h-4 w-4 rounded border border-slate-400 ${
        color === "white" ? "bg-white" : "bg-slate-800"}`} />
      <span className="max-w-full truncate text-sm font-medium" title={name}>{name}</span>
      <span className="text-xs text-slate-500">{rating ?? "?"}</span>
      <span className={`mt-1 rounded-lg px-3 py-1.5 text-2xl font-bold tabular-nums ${
        color === "white"
          ? "bg-slate-100 text-slate-900 dark:bg-slate-100"
          : "bg-slate-800 text-white dark:bg-slate-700"}`}
            data-testid={`accuracy-${color}`}>
        {accuracy === null ? "–" : accuracy.toFixed(1)}
      </span>
      <span className="text-[11px] uppercase tracking-wide text-slate-500">accuracy</span>
    </div>
  );
}

export default function SummaryPanel({ review, onJump }: {
  review: Review; onJump?: (ply: number) => void;
}) {
  const { white, black } = review;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Player name={white.username} rating={white.rating} accuracy={white.accuracy}
                color="white" />
        <Player name={black.username} rating={black.rating} accuracy={black.accuracy}
                color="black" />
      </div>

      <table className="w-full text-sm">
        <tbody>
          {CLASS_ORDER.map((c) => (
            <tr key={c} className="border-t border-slate-100 dark:border-slate-800">
              <td className="w-10 py-1 text-center font-semibold tabular-nums">{white.counts[c]}</td>
              <td className="py-1">
                <span className="flex items-center justify-center gap-2" style={{
                  color: CLASS_META[c].color }}>
                  <ClassIcon cls={c} size={16} />
                  <span className="w-20 text-left font-medium">{CLASS_META[c].label}</span>
                </span>
              </td>
              <td className="w-10 py-1 text-center font-semibold tabular-nums">{black.counts[c]}</td>
            </tr>
          ))}
          <tr className="border-t border-slate-200 dark:border-slate-700">
            <td className="py-2 text-center font-bold tabular-nums">{white.game_rating ?? "–"}</td>
            <td className="py-2 text-center text-xs text-slate-500">Game rating (estimate)</td>
            <td className="py-2 text-center font-bold tabular-nums">{black.game_rating ?? "–"}</td>
          </tr>
        </tbody>
      </table>

      {review.opening && (
        <p className="text-center text-sm">
          <span className="text-slate-500">Opening </span>
          <span className="font-medium">{review.opening.name}</span>{" "}
          <span className="text-xs text-slate-400">{review.opening.eco}</span>
        </p>
      )}

      {review.key_moments.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Key moments
          </h3>
          <ul className="space-y-1">
            {review.key_moments.map((k) => (
              <li key={k.ply}>
                <button onClick={() => onJump?.(k.ply)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left
                                   text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                  <ClassIcon cls={k.classification} size={15} />
                  <span className="font-medium tabular-nums">
                    {k.move_number}{k.color === "white" ? "." : "..."} {k.san}
                  </span>
                  {k.best_san !== k.san && (
                    <span className="truncate text-xs text-slate-500">best {k.best_san}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-center text-[11px] text-slate-400">
        {review.engine} · depth {review.depth}
      </p>
    </div>
  );
}
