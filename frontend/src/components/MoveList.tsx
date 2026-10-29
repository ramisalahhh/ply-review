import { useEffect, useRef } from "react";
import type { MoveReview } from "../lib/types";
import ClassIcon, { CLASS_META } from "./ClassIcon";

interface Props {
  moves: MoveReview[];
  currentPly: number;
  onSelect: (ply: number) => void;
}

interface Row {
  number: number;
  white?: MoveReview;
  black?: MoveReview;
}

export function toRows(moves: MoveReview[]): Row[] {
  const rows: Row[] = [];
  for (const m of moves) {
    let row = rows[rows.length - 1];
    if (!row || row.number !== m.move_number || (m.color === "white" && row.white)) {
      row = { number: m.move_number };
      rows.push(row);
    }
    row[m.color] = m;
  }
  return rows;
}

function Cell({ m, active, onSelect }: { m?: MoveReview; active: boolean;
                                         onSelect: (ply: number) => void }) {
  if (!m) return <span />;
  return (
    <button
      onClick={() => onSelect(m.ply)}
      data-ply={m.ply}
      aria-current={active ? "true" : undefined}
      aria-label={`${m.san}, ${CLASS_META[m.classification].label}`}
      className={`flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left font-medium
                  transition ${active
          ? "bg-brand-600 text-white"
          : "hover:bg-slate-200/80 dark:hover:bg-slate-800"}`}
    >
      <ClassIcon cls={m.classification} size={15} />
      <span className="truncate">{m.san}</span>
    </button>
  );
}

export default function MoveList({ moves, currentPly, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // keep the current move visible by scrolling only the panel, never the page
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-ply="${currentPly}"]`);
    let box = ref.current?.parentElement;
    while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement;
    if (!el || !box || box === document.documentElement) return;
    const e = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (e.top < b.top) box.scrollTop -= b.top - e.top + 8;
    else if (e.bottom > b.bottom) box.scrollTop += e.bottom - b.bottom + 8;
  }, [currentPly]);

  return (
    <div ref={ref} className="overflow-y-auto text-sm" role="list" aria-label="Moves">
      {toRows(moves).map((r) => (
        <div key={`${r.number}-${r.white?.ply ?? r.black?.ply}`} role="listitem"
             className="grid grid-cols-[2.25rem_1fr_1fr] items-center gap-1 px-1 py-0.5
                        odd:bg-slate-50 dark:odd:bg-slate-900/60">
          <span className="text-right text-xs text-slate-400 tabular-nums">{r.number}.</span>
          <Cell m={r.white} active={r.white?.ply === currentPly} onSelect={onSelect} />
          <Cell m={r.black} active={r.black?.ply === currentPly} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}
