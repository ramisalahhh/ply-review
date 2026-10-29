import type { Classification } from "../lib/types";

// Original badge set: a coloured disc with a white glyph per class.
export const CLASS_META: Record<Classification, { label: string; color: string }> = {
  brilliant: { label: "Brilliant", color: "#a855f7" },
  great: { label: "Great", color: "#3b82f6" },
  best: { label: "Best", color: "#10b981" },
  excellent: { label: "Excellent", color: "#14b8a6" },
  good: { label: "Good", color: "#84a98c" },
  book: { label: "Book", color: "#a47148" },
  inaccuracy: { label: "Inaccuracy", color: "#eab308" },
  mistake: { label: "Mistake", color: "#f97316" },
  miss: { label: "Miss", color: "#ec4899" },
  blunder: { label: "Blunder", color: "#dc2626" },
};

function Glyph({ cls }: { cls: Classification }) {
  const text = (t: string, size = 11) => (
    <text x="10" y="10.5" textAnchor="middle" dominantBaseline="central" fontSize={size}
          fontWeight="800" fontFamily="system-ui, sans-serif" fill="#fff">{t}</text>
  );
  switch (cls) {
    case "brilliant": return text("!!", 10);
    case "great": return text("!", 12);
    case "inaccuracy": return text("?!", 9.5);
    case "mistake": return text("?", 12);
    case "blunder": return text("??", 10);
    case "best":
      return <path d="M10 4.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L10 13l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z"
                   fill="#fff" />;
    case "excellent":
      return <path d="M6 10.4l2.7 2.7L14.2 7" fill="none" stroke="#fff" strokeWidth="2.4"
                   strokeLinecap="round" strokeLinejoin="round" />;
    case "good":
      return <circle cx="10" cy="10" r="3.2" fill="none" stroke="#fff" strokeWidth="2.2" />;
    case "book":
      return <path d="M5.5 6.5c1.8-.6 3.2-.4 4.5.6 1.3-1 2.7-1.2 4.5-.6v7c-1.8-.6-3.2-.4-4.5.6-1.3-1-2.7-1.2-4.5-.6z"
                   fill="none" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />;
    case "miss":
      return <path d="M7 7l6 6M13 7l-6 6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />;
  }
}

export default function ClassIcon({ cls, size = 18, title = true }: {
  cls: Classification; size?: number | string; title?: boolean;
}) {
  const meta = CLASS_META[cls];
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} role="img" aria-label={meta.label}
         className="shrink-0 drop-shadow-sm">
      {title && <title>{meta.label}</title>}
      <circle cx="10" cy="10" r="9.3" fill={meta.color} stroke="#fff" strokeWidth="1.2" />
      <Glyph cls={cls} />
    </svg>
  );
}
