import type { BatchItemResult, ConfidenceBand } from './types';

/**
 * Deep-mode windowing. Mirrors the alphainfo SDK's `analyze_windowed`
 * helper: windows are sliced client-side and analyzed via one
 * POST /v1/analyze/batch call — there is no dedicated windowed endpoint.
 *
 * The suite uses NON-overlapping windows (step = window size), unlike the
 * SDK default, so the timeline renders as clean adjacent segments and the
 * quota cost is exactly `windowCount` analyses per run.
 */

/** Engine hard minimum per the alphainfo contract. */
const ENGINE_MIN_SAMPLES = 10;

/** Free/Starter cap on signals per batch call — one deep run must always
 *  fit a single batch request on every tier. */
export const MAX_DEEP_WINDOWS = 10;
export const MIN_DEEP_WINDOWS = 2;

export interface SignalWindow {
  /** Inclusive start index into the source series. */
  startIdx: number;
  /** Exclusive end index into the source series. */
  endIdx: number;
  values: number[];
}

/**
 * Slice `values` into up to `windowCount` non-overlapping, equal-width
 * windows covering the whole series (the last window absorbs the
 * remainder). Returns null when the series cannot yield at least
 * MIN_DEEP_WINDOWS windows of the engine minimum — callers surface that
 * as "series too short for deep mode".
 */
export function sliceWindows(values: number[], windowCount: number): SignalWindow[] | null {
  const requested = clampWindowCount(windowCount);
  // Largest count that keeps every window >= the engine minimum.
  const feasible = Math.min(requested, Math.floor(values.length / ENGINE_MIN_SAMPLES));
  if (feasible < MIN_DEEP_WINDOWS) {
    return null;
  }
  const size = Math.floor(values.length / feasible);
  const windows: SignalWindow[] = [];
  for (let i = 0; i < feasible; i++) {
    const startIdx = i * size;
    // Last window absorbs the division remainder so coverage is total.
    const endIdx = i === feasible - 1 ? values.length : startIdx + size;
    windows.push({ startIdx, endIdx, values: values.slice(startIdx, endIdx) });
  }
  return windows;
}

export function clampWindowCount(n: number): number {
  if (!Number.isFinite(n)) {
    return MIN_DEEP_WINDOWS;
  }
  return Math.max(MIN_DEEP_WINDOWS, Math.min(MAX_DEEP_WINDOWS, Math.floor(n)));
}

/** One scored timeline segment; `band`/`score` are null when that window
 *  failed server-side (batch responses fail per-item, not per-call). */
export interface DeepWindowResult {
  startIdx: number;
  endIdx: number;
  score: number | null;
  band: ConfidenceBand | null;
  error: string | null;
}

export interface DeepTimelineResult {
  windows: DeepWindowResult[];
  /** Lowest-scoring (most divergent) window, or null if all failed. */
  worst: DeepWindowResult | null;
  analysesConsumed: number;
  failedCount: number;
}

/**
 * Join the sliced windows with their per-item batch results. The batch
 * API returns `results` in submission order WITHOUT an `index` field
 * (verified on the wire against production); positional order is the
 * source of truth, and an explicit numeric `index` wins when present.
 */
export function assembleDeepTimeline(
  windows: SignalWindow[],
  results: BatchItemResult[],
  analysesConsumed: number,
): DeepTimelineResult {
  const byIndex = new Map<number, BatchItemResult>();
  results.forEach((r, position) => {
    byIndex.set(typeof r.index === 'number' ? r.index : position, r);
  });
  const out: DeepWindowResult[] = windows.map((w, i) => {
    const r = byIndex.get(i);
    if (!r || r.error != null || typeof r.structural_score !== 'number') {
      return {
        startIdx: w.startIdx,
        endIdx: w.endIdx,
        score: null,
        band: null,
        error: r?.error ?? 'missing result',
      };
    }
    return {
      startIdx: w.startIdx,
      endIdx: w.endIdx,
      score: r.structural_score,
      band: r.confidence_band,
      error: null,
    };
  });
  let worst: DeepWindowResult | null = null;
  for (const w of out) {
    if (w.score !== null && (worst === null || worst.score === null || w.score < worst.score)) {
      worst = w;
    }
  }
  return {
    windows: out,
    worst,
    analysesConsumed,
    failedCount: out.filter((w) => w.error !== null).length,
  };
}
