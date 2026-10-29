import type { MouseEvent } from "react";
import type { MoveReview } from "../lib/types";
import { CLASS_META } from "./ClassIcon";

const MARKED = new Set(["brilliant", "great", "mistake", "miss", "blunder"]);

interface Props {
  whiteWin: number[]; // per position, start first
  moves: MoveReview[];
  currentPly: number;
  onSelect: (ply: number) => void;
}

/** White's win% across the game. Click anywhere to jump to that move. */
export default function EvalGraph({ whiteWin, moves, currentPly, onSelect }: Props) {
  const n = Math.max(1, whiteWin.length - 1);
  const W = 600;
  const H = 120;
  const x = (i: number) => (i / n) * W;
  const y = (v: number) => H - (v / 100) * H;
  const pts = whiteWin.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  function click(e: MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const ply = Math.round(((e.clientX - r.left) / r.width) * n);
    onSelect(Math.max(0, Math.min(n, ply)));
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onClick={click}
         className="h-24 w-full cursor-pointer rounded-lg bg-slate-700 sm:h-28"
         role="img" aria-label="Evaluation graph">
      <polygon points={`0,${H} ${pts} ${W},${H}`} className="fill-slate-50" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="stroke-slate-400" strokeWidth="1"
            strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <line x1={x(currentPly)} x2={x(currentPly)} y1="0" y2={H} className="stroke-brand-500"
            strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {moves.filter((m) => MARKED.has(m.classification)).map((m) => (
        <circle key={m.ply} cx={x(m.ply)} cy={y(whiteWin[m.ply])} r="4.5"
                fill={CLASS_META[m.classification].color} stroke="#fff" strokeWidth="1.2"
                vectorEffect="non-scaling-stroke">
          <title>{`${m.move_number}${m.color === "white" ? "." : "..."} ${m.san}: ${
            CLASS_META[m.classification].label}`}</title>
        </circle>
      ))}
    </svg>
  );
}
