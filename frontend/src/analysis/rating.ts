// Port of backend/analysis/rating.py: piecewise-linear accuracy -> rating curve.

export function interpolate(curve: [number, number][], x: number): number {
  const pts = [...curve].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return pts[pts.length - 1][1];
}

/** Python's round(): halves go to the nearest even number. */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function estimateRating(accuracy: number | null, curve: [number, number][], moves: number,
                               playerRating: number | null = null, fullWeightMoves = 20):
    number | null {
  if (accuracy === null) return null;
  let est = interpolate(curve, accuracy);
  if (playerRating && moves < fullWeightMoves) {
    const w = moves / fullWeightMoves;
    est = w * est + (1 - w) * playerRating;
  }
  return roundHalfEven(est / 50) * 50;
}
