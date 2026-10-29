// Port of backend/analysis/accuracy.py (the open Lichess accuracy formula).

export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const diff = winBefore - winAfter;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * diff) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1));
}

function pstdev(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

function weightedMean(pairs: [number, number][]): number {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  return total ? pairs.reduce((a, [v, w]) => a + v * w, 0) / total : 0;
}

function harmonicMean(values: number[]): number {
  return values.length ? values.length / values.reduce((a, v) => a + 1 / Math.max(1, v), 0) : 0;
}

export function windowWeights(whiteWin: number[], windowMin = 2, windowMax = 8): number[] {
  const n = whiteWin.length;
  let size = Math.max(windowMin, Math.min(windowMax, Math.floor(n / 10)));
  size = Math.min(size, n);
  const windows: number[][] = [];
  for (let i = 0; i < Math.max(0, size - 2); i++) windows.push(whiteWin.slice(0, size));
  for (let i = 0; i <= n - size; i++) windows.push(whiteWin.slice(i, i + size));
  return windows.slice(0, n - 1).map((w) => {
    const sd = w.length > 1 ? pstdev(w) : 0;
    return Math.max(0.5, Math.min(12, sd));
  });
}

export function perMoveAccuracies(whiteWin: number[], whiteFirst = true): number[] {
  const out: number[] = [];
  for (let i = 0; i < whiteWin.length - 1; i++) {
    const prev = whiteWin[i];
    const next = whiteWin[i + 1];
    const whiteMoved = (i % 2 === 0) === whiteFirst;
    out.push(whiteMoved ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next));
  }
  return out;
}

export function gameAccuracy(whiteWin: number[], whiteFirst = true, windowMin = 2,
                             windowMax = 8): { white: number | null; black: number | null } {
  const accs = perMoveAccuracies(whiteWin, whiteFirst);
  const weights = windowWeights(whiteWin, windowMin, windowMax);
  const forColor = (parity: number): number | null => {
    const idx = accs.map((_, i) => i).filter((i) => i % 2 === parity);
    if (idx.length === 0) return null;
    const weighted = weightedMean(idx.map((i) => [accs[i], weights[i]]));
    const harmonic = harmonicMean(idx.map((i) => accs[i]));
    return (weighted + harmonic) / 2;
  };
  return { white: forColor(whiteFirst ? 0 : 1), black: forColor(whiteFirst ? 1 : 0) };
}

/** q = 1 arithmetic, 0 geometric, -1 harmonic mean (values floored at 1). */
export function powerMean(xs: number[], q: number): number {
  const v = xs.map((x) => Math.max(x, 1));
  if (q === 0) return Math.exp(v.reduce((s, x) => s + Math.log(x), 0) / v.length);
  return (v.reduce((s, x) => s + x ** q, 0) / v.length) ** (1 / q);
}

/** Accuracy fitted to chess.com's numbers. losses: expected points lost x 100 per move. */
export function fittedAccuracy(losses: number[], m: { k: number; p: number; q: number;
                                                    a: number; b: number }): number | null {
  if (losses.length === 0) return null;
  const pm = powerMean(losses.map((d) => 100 * Math.exp(-m.k * Math.max(0, d) ** m.p)), m.q);
  return Math.max(0, Math.min(100, m.a * pm + m.b));
}
