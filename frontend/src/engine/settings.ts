// Engine strength presets and per-device defaults, remembered in localStorage.
import type { SearchLimits } from "./types";

export type Preset = "fast" | "normal" | "deep";

export const PRESETS: Record<Preset, { label: string; depth: number; movetimeMs: number }> = {
  fast: { label: "Fast", depth: 12, movetimeMs: 1500 },
  normal: { label: "Normal", depth: 16, movetimeMs: 3000 },
  deep: { label: "Deep", depth: 18, movetimeMs: 6000 },
};

export interface EngineSettings {
  preset: Preset;
  workers: number;
}

const KEY = "engine-settings";

export function isMobile(): boolean {
  try {
    return matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 820;
  } catch {
    return false;
  }
}

export function maxWorkers(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(8, cores));
}

export function defaultSettings(): EngineSettings {
  const cores = maxWorkers();
  // leave a core free so the page stays smooth; phones get fewer, shallower workers
  return isMobile()
    ? { preset: "fast", workers: Math.max(1, Math.min(2, cores - 1)) }
    : { preset: "normal", workers: Math.max(1, Math.min(6, cores - 1)) };
}

export function loadSettings(): EngineSettings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<EngineSettings>;
    return {
      preset: s.preset && s.preset in PRESETS ? s.preset : d.preset,
      workers: Math.max(1, Math.min(maxWorkers(), Number(s.workers) || d.workers)),
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: EngineSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings just won't be remembered */
  }
}

export function limitsFor(preset: Preset, multipv = 2): SearchLimits {
  const p = PRESETS[preset];
  return { depth: p.depth, movetimeMs: p.movetimeMs, multipv };
}

export const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;
