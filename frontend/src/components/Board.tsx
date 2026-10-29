import type { CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import type { Classification } from "../lib/types";
import ClassIcon from "./ClassIcon";

export const BOARD_COLORS = {
  lightSquareStyle: { backgroundColor: "var(--color-sq-light)" },
  darkSquareStyle: { backgroundColor: "var(--color-sq-dark)" },
  lightSquareNotationStyle: { color: "var(--color-sq-dark)" },
  darkSquareNotationStyle: { color: "var(--color-sq-light)" },
};

export interface BoardArrow {
  from: string;
  to: string;
  color: string;
}

interface Props {
  fen: string;
  orientation: "white" | "black";
  lastMove?: { from: string; to: string } | null;
  icon?: { square: string; cls: Classification } | null;
  arrows?: BoardArrow[];
  highlight?: string; // last-move tint
}

export default function Board({ fen, orientation, lastMove, icon, arrows = [],
                                highlight = "rgba(250, 204, 21, 0.42)" }: Props) {
  const squareStyles: Record<string, CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { backgroundColor: highlight };
    squareStyles[lastMove.to] = { backgroundColor: highlight };
  }

  return (
    <Chessboard
      options={{
        id: "review",
        position: fen,
        boardOrientation: orientation,
        allowDragging: false,
        allowDrawingArrows: true,
        animationDurationInMs: 160,
        squareStyles,
        arrows: arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: a.color })),
        boardStyle: { borderRadius: "6px", overflow: "visible" },
        ...BOARD_COLORS,
        squareRenderer: ({ square, children }) => (
          // a custom renderer must apply squareStyles itself
          <div style={{ position: "relative", width: "100%", height: "100%",
                        ...squareStyles[square] }}>
            {children}
            {icon && icon.square === square && (
              <div style={{ position: "absolute", top: "-14%", right: "-14%", zIndex: 30,
                            width: "44%", height: "44%", pointerEvents: "none" }}>
                <ClassIcon cls={icon.cls} size="100%" title={false} />
              </div>
            )}
          </div>
        ),
      }}
    />
  );
}
