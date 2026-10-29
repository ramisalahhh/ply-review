import { describe, expect, it } from "vitest";
import { fittedAccuracy, powerMean } from "./accuracy";
import { CONFIG } from "./config";

describe("fitted (chess.com-like) accuracy", () => {
  it("power mean: arithmetic, geometric, harmonic", () => {
    expect(powerMean([100, 25], 1)).toBeCloseTo(62.5);
    expect(powerMean([100, 25], 0)).toBeCloseTo(50);
    expect(powerMean([100, 25], -1)).toBeCloseTo(40);
  });

  it("is switched on in the shipped config", () => {
    expect(CONFIG.accuracy.model).not.toBeNull();
  });

  it("falls as moves get worse and stays within 0-100", () => {
    const m = CONFIG.accuracy.model!;
    const a = fittedAccuracy(Array(20).fill(1), m)!;
    const b = fittedAccuracy(Array(20).fill(5), m)!;
    const c = fittedAccuracy(Array(20).fill(15), m)!;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(fittedAccuracy(Array(10).fill(90), m)).toBeGreaterThanOrEqual(0);
    expect(fittedAccuracy([], m)).toBeNull();
  });
});
