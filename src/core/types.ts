/**
 * TypeScript contracts for the alphainfo v2 API.
 * Keep in sync with https://www.alphainfo.io/openapi.json and /v1/guide.
 */

export type ConfidenceBand = 'stable' | 'transition' | 'unstable';

export type AlertLevel = 'normal' | 'attention' | 'alert' | 'critical';

export type RecommendedAction =
  | 'log_only'
  | 'monitor'
  | 'human_review'
  | 'immediate_human_review';

export type Trend = 'stable' | 'monitoring' | 'diverging';

export type Severity = 'none' | 'low' | 'moderate' | 'high' | 'critical';

export type AlphaInfoDomain =
  | 'generic'
  | 'finance'
  | 'biomedical'
  | 'sensors'
  | 'security'
  | 'ai_ml'
  | 'power_grid'
  | 'seismic'
  | 'traffic';

export interface SemanticResult {
  summary: string;
  alert_level: AlertLevel;
  recommended_action: RecommendedAction | null;
  trend: Trend | null;
  severity: Severity | null;
  severity_score: number | null;
}

/**
 * The 5-dimensional structural fingerprint returned inside `metrics`.
 * All values are similarity scores in [0, 1]; higher = more preserved.
 * Kept in sync with the alphainfo SDK 1.5.14 `FingerprintResult` model.
 *
 * In responses, every `sim_*` field is nullable — the engine omits them
 * when `fingerprint_available` is false. Use `AnalyzeResponseMetrics`
 * (the looser shape on the wire) and narrow to this interface only when
 * all five values are finite numbers.
 */
export interface FingerprintMetrics {
  sim_local: number;
  sim_spectral: number;
  sim_fractal: number;
  sim_transition: number;
  sim_trend: number;
}

/**
 * Why the engine could not emit the 5D fingerprint. Mirrors the
 * SDK 1.5.14 `FingerprintResult.fingerprint_reason` enum.
 */
export type FingerprintReason =
  | 'signal_too_short'
  | 'structural_degenerate'
  | 'internal_error';

/**
 * Shape of `AnalyzeResponse.metrics` on the wire. Superset of
 * FingerprintMetrics; every known sim_* field is optional because the
 * engine can omit them when `fingerprint_available` is false.
 */
export interface AnalyzeResponseMetrics {
  sim_local?: number | null;
  sim_spectral?: number | null;
  sim_fractal?: number | null;
  sim_transition?: number | null;
  sim_trend?: number | null;
  /** True when all five sim_* were computed for this signal. */
  fingerprint_available?: boolean;
  /** Populated only when `fingerprint_available` is false. */
  fingerprint_reason?: FingerprintReason | null;
  /** Other engine-side metrics (energy_ratio, complexity_index, …) kept
   *  opaque to the plugin — shown as supplementary context only. */
  [key: string]: unknown;
}

/**
 * Confidence and reasoning when the server picks a domain automatically
 * (new since SDK 1.5.14 / API 2.3.0). Returned on responses where the
 * client requested `domain='auto'`.
 */
export interface DomainInference {
  confidence: number;
  reason?: string;
  [key: string]: unknown;
}

export interface AnalyzeRequest {
  signal: number[];
  sampling_rate: number;
  domain?: AlphaInfoDomain | 'auto';
  baseline?: number[];
  metadata?: Record<string, unknown>;
  include_semantic?: boolean;
  use_multiscale?: boolean;
}

export interface AnalyzeResponse {
  structural_score: number;
  change_detected: boolean;
  change_score: number;
  confidence_band: ConfidenceBand;
  engine_version: string;
  analysis_id: string;
  metrics: AnalyzeResponseMetrics | null;
  semantic: SemanticResult | null;
  warning: string | null;
  /** Calibration the engine actually applied (echoed for confirmation,
   *  or chosen by the server when domain='auto'). API 2.3.0+. */
  domain_applied?: string;
  /** Present when `domain='auto'` — server's confidence and reason. */
  domain_inference?: DomainInference;
}

export interface HealthResponse {
  status: string;
  version: string;
  message?: string;
}

/**
 * Batch analysis — POST /v1/analyze/batch. Contract verified against the
 * alphainfo Python SDK 1.5.30 (`_build_batch_payload` / `_parse_batch`).
 * Each signal in the batch costs 1 analysis; the server caps a single
 * request at 100 signals and tiers cap it lower (Free/Starter 10,
 * Growth 50, Pro/Enterprise 100).
 */
export interface BatchAnalyzeRequest {
  signals: number[][];
  sampling_rate: number;
  domain?: AlphaInfoDomain | 'auto';
  include_semantic?: boolean;
  use_multiscale?: boolean;
  /** Optional per-signal baselines; same length as `signals`. */
  baselines?: Array<number[] | null>;
}

/** Per-signal result inside a batch response. `error` is set when that
 *  window failed; the scored fields are then null.
 *  NOTE (verified on the wire 2026-07-11): the production API does NOT
 *  send an `index` field — results arrive in submission order. The SDK
 *  falls back to positional order and so do we. */
export interface BatchItemResult {
  index?: number;
  structural_score: number | null;
  change_detected: boolean | null;
  change_score: number | null;
  confidence_band: ConfidenceBand | null;
  engine_version: string | null;
  analysis_id: string | null;
  metrics: AnalyzeResponseMetrics | null;
  semantic: SemanticResult | null;
  error: string | null;
}

export interface BatchAnalyzeResponse {
  results: BatchItemResult[];
  analyses_consumed: number;
  total_signals: number;
}
