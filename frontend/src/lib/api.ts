import type { AnalysisStatus, GameSummary, Review } from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep statusText */
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  games: (username: string, limit = 30) =>
    request<GameSummary[]>(`/users/${encodeURIComponent(username)}/games?limit=${limit}`),
  start: (body: { username?: string; game?: string; pgn?: string }) =>
    request<AnalysisStatus>("/analyses", { method: "POST", body: JSON.stringify(body) }),
  status: (jobId: string) => request<AnalysisStatus>(`/analyses/${jobId}`),
  cancel: (jobId: string) => request<AnalysisStatus>(`/analyses/${jobId}`, { method: "DELETE" }),
  review: (id: string) => request<Review>(`/reviews/${id}`),
  eventsUrl: (jobId: string) => `${BASE}/analyses/${jobId}/events`,
};
