// Thresholds exported from config.yaml by scripts/export_web_data.py.
import data from "../data/config.json";

export interface ClassificationConfig {
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  great_gap: number;
  great_exclude_recaptures: boolean;
  brilliant_max_loss: number;
  brilliant_min_sacrifice: number;
  brilliant_min_ep_after: number;
  decided_threshold: number;
  miss_opponent_gain: number;
  miss_given_back: number;
}

export interface AnalysisConfig {
  classification: ClassificationConfig;
  accuracy: { window_min: number; window_max: number };
  rating: { curve: [number, number][]; full_weight_moves: number };
  report: { key_moments: number; variation_plies: number };
}

export const CONFIG = data as unknown as AnalysisConfig;
