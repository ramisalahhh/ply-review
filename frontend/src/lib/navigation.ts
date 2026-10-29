// Pure navigation state for the review board: which ply is shown, and an
// optional engine line being played out on top of the game.

export interface LineMove {
  san: string;
  from: string;
  to: string;
  fen: string;
  capture: boolean;
  check: boolean;
}

export interface Line {
  basePly: number;   // game ply the line starts from (position before the move)
  returnPly: number; // ply to go back to when the line is closed
  startFen: string;
  moves: LineMove[];
  idx: number;       // 0 = start position, k = after moves[k-1]
}

export interface NavState {
  ply: number;   // 0 = start position, k = after move k
  total: number; // number of moves in the game
  line: Line | null;
}

export type NavAction =
  | { type: "first" }
  | { type: "prev" }
  | { type: "next" }
  | { type: "last" }
  | { type: "goto"; ply: number }
  | { type: "startLine"; line: Omit<Line, "idx" | "returnPly">; autoplay?: boolean }
  | { type: "exitLine" };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function initNav(total: number, ply = 0): NavState {
  return { ply: clamp(ply, 0, total), total, line: null };
}

export function navReducer(state: NavState, action: NavAction): NavState {
  const { line } = state;
  if (line) {
    const n = line.moves.length;
    switch (action.type) {
      case "next":
        return { ...state, line: { ...line, idx: clamp(line.idx + 1, 0, n) } };
      case "prev":
        if (line.idx === 0) return { ...state, ply: line.returnPly, line: null };
        return { ...state, line: { ...line, idx: line.idx - 1 } };
      case "first":
        return { ...state, line: { ...line, idx: 0 } };
      case "last":
        return { ...state, line: { ...line, idx: n } };
      case "exitLine":
        return { ...state, ply: line.returnPly, line: null };
      case "goto":
        return { ...state, ply: clamp(action.ply, 0, state.total), line: null };
      case "startLine":
        break; // replace the current line below
    }
  }
  switch (action.type) {
    case "first":
      return { ...state, ply: 0 };
    case "prev":
      return { ...state, ply: clamp(state.ply - 1, 0, state.total) };
    case "next":
      return { ...state, ply: clamp(state.ply + 1, 0, state.total) };
    case "last":
      return { ...state, ply: state.total };
    case "goto":
      return { ...state, ply: clamp(action.ply, 0, state.total) };
    case "startLine":
      if (action.line.moves.length === 0) return state;
      return {
        ...state,
        line: { ...action.line, returnPly: line ? line.returnPly : state.ply,
                idx: action.autoplay ? 1 : 0 },
      };
    case "exitLine":
      return state;
  }
}

/** Keyboard shortcut -> action (null if the key is not ours). */
export function keyToAction(key: string): NavAction | null {
  switch (key) {
    case "ArrowLeft": return { type: "prev" };
    case "ArrowRight": return { type: "next" };
    case "ArrowUp":
    case "Home": return { type: "first" };
    case "ArrowDown":
    case "End": return { type: "last" };
    case "Escape": return { type: "exitLine" };
    default: return null;
  }
}
