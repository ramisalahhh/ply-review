// Port of backend/fetch/models.py: chess.com game objects -> what the UI shows.
import type { GameSummary } from "./types";

export interface RawPlayer {
  username: string;
  rating?: number;
  result: string;
}

export interface RawGame {
  url: string;
  pgn?: string;
  end_time?: number;
  time_control?: string;
  time_class?: string;
  rules?: string;
  rated?: boolean;
  white: RawPlayer;
  black: RawPlayer;
}

const WIN = new Set(["win"]);
const DRAW = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move",
  "timevsinsufficient"]);

/** "600" -> "10 min", "180+2" -> "3|2", "1/86400" -> "1 day". */
export function formatTimeControl(tc: string | undefined): string {
  if (!tc) return "?";
  if (tc.includes("/")) {
    const secs = Number(tc.split("/")[1]);
    const days = Math.floor(secs / 86400);
    return days ? `${days} day${days !== 1 ? "s" : ""}` : `${Math.floor(secs / 3600)} h`;
  }
  const [base, inc] = tc.split("+");
  const b = Number(base);
  const label = b % 60 === 0 ? `${b / 60}` : `${Number((b / 60).toFixed(10))}`;
  return inc && inc !== "0" ? `${label}|${inc}` : `${label} min`;
}

/** Normalise chess.com game URLs to "live/123" or "daily/123". */
export function gameIdFromUrl(url: string): string | null {
  const m = /\/(live|daily)\/(?:game\/)?(\d+)|\/game\/(live|daily)\/(\d+)/.exec(url);
  if (!m) return null;
  return `${m[1] ?? m[3]}/${m[2] ?? m[4]}`;
}

export function gameId(g: RawGame): string {
  return gameIdFromUrl(g.url) ?? g.url;
}

export function colorOf(g: RawGame, username: string): "white" | "black" {
  return g.white.username.toLowerCase() === username.toLowerCase() ? "white" : "black";
}

export function outcomeFor(g: RawGame, username: string): "win" | "loss" | "draw" {
  const code = g[colorOf(g, username)].result;
  if (WIN.has(code)) return "win";
  if (DRAW.has(code)) return "draw";
  return "loss";
}

export function resultTag(g: RawGame): string {
  if (WIN.has(g.white.result)) return "1-0";
  if (WIN.has(g.black.result)) return "0-1";
  return "1/2-1/2";
}

export function isStandard(g: RawGame): boolean {
  return (g.rules ?? "chess") === "chess" && !!g.pgn;
}

export function toSummary(g: RawGame, username: string, index: number,
                          reviewId: string | null): GameSummary {
  const me = colorOf(g, username);
  const opp = me === "white" ? g.black : g.white;
  return {
    index,
    url: g.url,
    game_id: gameId(g),
    date: new Date((g.end_time ?? 0) * 1000).toISOString(),
    time_control: formatTimeControl(g.time_control),
    time_class: g.time_class ?? "",
    rated: g.rated ?? true,
    white: g.white.username,
    white_rating: g.white.rating ?? null,
    black: g.black.username,
    black_rating: g.black.rating ?? null,
    result: resultTag(g),
    my_color: me,
    outcome: outcomeFor(g, username),
    opponent: opp.username,
    opponent_rating: opp.rating ?? null,
    review_id: reviewId,
  };
}
