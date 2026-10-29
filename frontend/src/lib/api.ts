// What the pages call. Everything runs in this browser: games come straight
// from chess.com, Stockfish runs in Web Workers, reviews are saved locally.
import { local, type JobEvent } from "./local";
import type { AnalysisStatus, GameSummary, Review } from "./types";

export type { JobEvent };

export const api = {
  games: (username: string, limit = 30): Promise<GameSummary[]> => local.games(username, limit),
  start: (body: { username?: string; game?: string; pgn?: string }): Promise<AnalysisStatus> =>
    local.start(body),
  cancel: async (jobId: string): Promise<void> => local.cancel(jobId),
  review: (id: string): Promise<Review> => local.review(id),
  subscribe: (jobId: string, listener: (e: JobEvent) => void) => local.subscribe(jobId, listener),
};
