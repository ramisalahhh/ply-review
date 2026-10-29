interface Props {
  whiteWin: number; // 0-100
  label: string;
  orientation: "white" | "black";
  horizontal?: boolean;
}

/** White's share of the bar = White's winning chances. */
export default function EvalBar({ whiteWin, label, orientation, horizontal = false }: Props) {
  const pct = Math.max(2, Math.min(98, whiteWin));
  const whiteBottom = orientation === "white";
  const whiteAhead = whiteWin >= 50;
  const labelCls = "absolute z-10 text-[10px] font-bold tabular-nums leading-none";

  if (horizontal) {
    return (
      <div className="relative h-4 w-full overflow-hidden rounded bg-slate-800" aria-label={`Evaluation ${label}`}>
        <div className="absolute inset-y-0 bg-slate-50 transition-all duration-300"
             style={{ width: `${pct}%`, [whiteBottom ? "left" : "right"]: 0 }} />
        <span className={`${labelCls} top-1/2 -translate-y-1/2 ${
          whiteAhead === whiteBottom ? "left-1.5" : "right-1.5"} ${
          whiteAhead ? "text-slate-800" : "text-slate-100"}`}>{label}</span>
      </div>
    );
  }
  return (
    <div className="relative w-6 shrink-0 self-stretch overflow-hidden rounded bg-slate-800 sm:w-7"
         aria-label={`Evaluation ${label}`} data-testid="eval-bar">
      <div className="absolute inset-x-0 bg-slate-50 transition-all duration-300"
           style={{ height: `${pct}%`, [whiteBottom ? "bottom" : "top"]: 0 }} />
      <span className={`${labelCls} inset-x-0 text-center ${
        whiteAhead === whiteBottom ? "bottom-1" : "top-1"} ${
        whiteAhead ? "text-slate-800" : "text-slate-100"}`}>{label}</span>
    </div>
  );
}
