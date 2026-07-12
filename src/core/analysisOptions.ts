import type { AlphaInfoDomain } from './types';

/**
 * Options contract consumed by the core analysis hooks and panel factory.
 * Each plugin in the AlphaInfo suite stores exactly this shape in its
 * dashboard JSON; per-plugin differences live in `PluginBranding` and in
 * the default values passed to `buildPanelOptions`, never in this shape.
 *
 * The `apiKey` field is plain text because Grafana panel plugins have no
 * equivalent of datasource `secureJsonData`. The suite README documents
 * the trade-off; a companion datasource plugin is the roadmap answer.
 */
export interface CoreAnalysisOptions {
  apiKey: string;
  baseUrl: string;
  domain: AlphaInfoDomain | 'auto';
  samplingRate: number;
  /**
   * Upper bound for the samples sent to the API. Longer series are
   * uniformly downsampled. Tier caps: Free 10k · Starter 100k ·
   * Growth 500k · Pro 1M · Enterprise 5M. Default (9.5k) is Free-safe.
   */
  maxSignalSamples: number;
  useMultiscale: boolean;
  includeSemantic: boolean;
  /**
   * When on, each dashboard refresh re-runs the analysis (subject to the
   * 30 s response cache). Off by default across the suite: one analysis
   * per explicit user action keeps Free-tier quota (50/month) usable.
   */
  refreshOnQuery: boolean;
  /**
   * Manual / on-demand mode — the panel waits for an explicit
   * "Analyze now" click before spending quota. Default ON across the
   * suite: this is the Free-tier-friendly mode; auto-refresh is the
   * upgrade moment.
   */
  runOnDemand: boolean;
  /**
   * What the verdict is measured against.
   *
   * 'window-start' (default): the first `baselineFraction` of the visible
   * window is sent as the baseline and the remainder as the signal — one
   * analysis answering "did the recent part change vs the start?".
   * Validated 2026-07-11 against the production engine: healthy dynamic
   * signals (noise/periodic) read stable (0.79-0.82) while a regime break
   * reads unstable (0.06), given ≥400 samples per half.
   *
   * 'internal': the whole window is sent without a baseline and the engine
   * judges self-consistency. Dynamic-but-healthy signals (trends,
   * periodicity) often read as transition/unstable here — use it for
   * signals that are supposed to be flat.
   *
   * Falls back to 'internal' automatically when the window is too short
   * to split (either half under 10 samples).
   */
  referenceMode: 'window-start' | 'internal';
  /** Kept for hook compatibility; the lean SKUs never enable it. */
  useBaselineComparison: boolean;
  baselineFraction: number;
  /**
   * Deep mode — slices the visible series into `deepWindowCount`
   * non-overlapping windows and analyzes each via one
   * POST /v1/analyze/batch call, rendering a per-window timeline of
   * where the change happened. Costs `deepWindowCount` extra analyses
   * per run. Opt-in.
   */
  deepMode: boolean;
  /**
   * Number of windows for deep mode. Clamped to [2, 10] — 10 is the
   * Free/Starter batch cap, so one deep run always fits a single batch
   * call on every tier.
   */
  deepWindowCount: number;
  showBadge: boolean;
  showOverlay: boolean;
  /** Sidebar: semantic reading + "what changed" interpretation. */
  showInsight: boolean;
  /** Sidebar: the 5-dimensional structural fingerprint radar (D1..D5). */
  showFingerprint: boolean;
  /** Sidebar: audit replay modal (full recorded payload; free of quota). */
  showAuditLink: boolean;
}

export const CORE_DEFAULT_OPTIONS: CoreAnalysisOptions = {
  apiKey: '',
  baseUrl: 'https://www.alphainfo.io',
  domain: 'auto',
  samplingRate: 0,
  maxSignalSamples: 9_500,
  useMultiscale: false,
  includeSemantic: true,
  refreshOnQuery: false,
  runOnDemand: true,
  referenceMode: 'window-start',
  useBaselineComparison: false,
  baselineFraction: 0.5,
  deepMode: false,
  deepWindowCount: 8,
  showBadge: true,
  showOverlay: true,
  showInsight: true,
  showFingerprint: true,
  showAuditLink: true,
};
