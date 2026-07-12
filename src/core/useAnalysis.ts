import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { FieldType, type DataFrame, type PanelData } from '@grafana/data';
import { analyze, type RateLimitInfo } from './client';
import type { AnalyzeResponse } from './types';
import type { CoreAnalysisOptions } from './analysisOptions';
import {
  extractNumericSeries,
  hashSignal,
  splitExtractedByFraction,
  type ExtractedSeries,
} from './dataTransform';
import { TTLCache } from './cache';

interface CachedOutcome {
  response: AnalyzeResponse;
  rateLimit: RateLimitInfo | null;
}

/** Shared across all panels: same (signal, sampling_rate, domain) = same answer. */
const responseCache = new TTLCache<CachedOutcome>(30_000);

const DEBOUNCE_MS = 500;

export type IdleReason =
  | 'no-api-key'
  | 'invalid-api-key-format'
  | 'no-data'
  | 'no-numeric-field'
  | 'series-too-short'
  | 'gap-too-large'
  /** useBaselineComparison=true but the split would leave a half below the engine minimum. */
  | 'baseline-window-too-short'
  /** runOnDemand=true and the user hasn't clicked Start yet. */
  | 'awaiting-start';

/**
 * Accompanying baseline analysis — populated when
 * `options.useBaselineComparison` is on and both halves of the split
 * window produced successful analyses. Null means the current series
 * was analyzed as a single window (1.0 behavior).
 */
export interface BaselineOutcome {
  response: AnalyzeResponse;
  extracted: ExtractedSeries;
}

/** What the delivered verdict was measured against (see CoreAnalysisOptions.referenceMode). */
export type ReferenceUsed = 'window-start' | 'internal';

export type AnalysisState =
  | { status: 'idle'; reason: IdleReason }
  | { status: 'loading'; extracted: ExtractedSeries }
  | { status: 'error'; error: Error; extracted: ExtractedSeries; retryAfter: number | null }
  | {
      status: 'success';
      response: AnalyzeResponse;
      extracted: ExtractedSeries;
      analyzedAt: number;
      fromCache: boolean;
      rateLimit: RateLimitInfo | null;
      baseline: BaselineOutcome | null;
      referenceUsed: ReferenceUsed;
    };

export interface UseAnalysisResult {
  state: AnalysisState;
  /**
   * Force a fresh re-run of the analyze pipeline regardless of cache —
   * useful as a "Try again" button after a transient error.
   */
  retry: () => void;
  /**
   * Trigger the first run when `runOnDemand=true`. No-op once the
   * panel has run at least once; further runs go through `retry()`.
   */
  start: () => void;
}

type Action =
  | { type: 'idle'; reason: IdleReason }
  | { type: 'loading'; extracted: ExtractedSeries }
  | { type: 'error'; error: Error; extracted: ExtractedSeries; retryAfter: number | null }
  | {
      type: 'success';
      response: AnalyzeResponse;
      extracted: ExtractedSeries;
      analyzedAt: number;
      fromCache: boolean;
      rateLimit: RateLimitInfo | null;
      baseline: BaselineOutcome | null;
      referenceUsed: ReferenceUsed;
    };

function reducer(_: AnalysisState, action: Action): AnalysisState {
  switch (action.type) {
    case 'idle':
      return { status: 'idle', reason: action.reason };
    case 'loading':
      return { status: 'loading', extracted: action.extracted };
    case 'error':
      return {
        status: 'error',
        error: action.error,
        extracted: action.extracted,
        retryAfter: action.retryAfter,
      };
    case 'success':
      return {
        status: 'success',
        response: action.response,
        extracted: action.extracted,
        analyzedAt: action.analyzedAt,
        fromCache: action.fromCache,
        rateLimit: action.rateLimit,
        baseline: action.baseline,
        referenceUsed: action.referenceUsed,
      };
  }
}

export interface UseAnalysisInput {
  data: PanelData;
  options: CoreAnalysisOptions;
}

/** Pick the first non-empty DataFrame from the panel data. */
function pickPrimaryFrame(data: PanelData): DataFrame | null {
  for (const frame of data.series) {
    if (frame.length > 0 && frame.fields.length > 0) {
      return frame;
    }
  }
  return null;
}

function buildCacheKey(
  hash: string,
  samplingRate: number,
  options: CoreAnalysisOptions,
  role = 'full',
): string {
  return [
    hash,
    samplingRate.toFixed(4),
    options.domain,
    options.useMultiscale ? '1' : '0',
    options.includeSemantic ? '1' : '0',
    options.baseUrl,
    role,
  ].join('|');
}

/**
 * Orchestrate the full analysis lifecycle for a Grafana panel:
 * pick a DataFrame, extract a numeric signal (downsampling long series),
 * consult the TTL cache, fall back to POST /v1/analyze/stream, and expose
 * a discriminated-union state so the UI can render every stage without
 * boolean soup. Cache hits carry the last observed rate-limit headers so
 * the UI can show "Quota N/Y · checked Ns ago" without misleading users.
 *
 * A 500ms debounce absorbs rapid option toggles in the Grafana editor.
 */
export function useAlphaInfoAnalysis(input: UseAnalysisInput): UseAnalysisResult {
  const [state, dispatch] = useReducer(reducer, { status: 'idle', reason: 'no-api-key' });
  const [retryToken, setRetryToken] = useState(0);
  // `startToken` doubles as a "Start was clicked at least once" signal
  // for runOnDemand mode. Bumped exactly once per user click; the same
  // mechanism also doubles as a manual re-analyze trigger.
  const [startToken, setStartToken] = useState(0);
  const retry = useCallback(() => setRetryToken((t) => t + 1), []);
  const start = useCallback(() => setStartToken((t) => t + 1), []);
  const { data, options } = input;

  const overrideSamplingRate =
    options.samplingRate > 0 ? options.samplingRate : undefined;

  // The `data` reference from Grafana changes every time the dashboard
  // refreshes, even when the underlying series is identical. When the
  // user opts out of auto-refresh we honor that by skipping the
  // network call on subsequent data changes, unless an option that
  // actually affects the analysis (API key, domain, multiscale, …) or
  // an explicit retry happened. This ref tracks the last `data` object
  // that we did analyze against.
  const lastAnalyzedDataRef = useRef<PanelData | null>(null);

  // Early idle states don't need network work; compute them every render.
  useEffect(() => {
    if (!options.apiKey) {
      dispatch({ type: 'idle', reason: 'no-api-key' });
      return;
    }
    if (!isLikelyValidKeyFormat(options.apiKey)) {
      dispatch({ type: 'idle', reason: 'invalid-api-key-format' });
      return;
    }

    // runOnDemand mode: hold at the awaiting-start idle state until
    // the user explicitly clicks Start (which bumps startToken).
    if (options.runOnDemand && startToken === 0) {
      dispatch({ type: 'idle', reason: 'awaiting-start' });
      return;
    }

    // If the user disabled auto-refresh, treat a fresh `data` object
    // with unchanged options as a no-op — keep the current analysis.
    // Retries (retryToken change) still pass through because they
    // represent an explicit user intent to re-analyze.
    const dataChangedOnly =
      lastAnalyzedDataRef.current !== null &&
      lastAnalyzedDataRef.current !== data;
    if (!options.refreshOnQuery && dataChangedOnly) {
      lastAnalyzedDataRef.current = data;
      return;
    }

    const frame = pickPrimaryFrame(data);
    if (!frame) {
      dispatch({ type: 'idle', reason: 'no-data' });
      return;
    }
    const numericField = frame.fields.find((f) => f.type === FieldType.number);
    if (!numericField) {
      dispatch({ type: 'idle', reason: 'no-numeric-field' });
      return;
    }
    const extracted = extractNumericSeries(frame, {
      fallbackSamplingRate: overrideSamplingRate,
      maxSamples: options.maxSignalSamples,
    });
    if (!extracted) {
      // Has a numeric field but extraction failed: either too few samples
      // after dropping non-finite values or the gap fraction exceeded the
      // threshold. Use the raw length to pick the more accurate reason.
      const rawLen = numericField.values.length ?? 0;
      dispatch({
        type: 'idle',
        reason: rawLen < 10 ? 'series-too-short' : 'gap-too-large',
      });
      return;
    }

    const samplingRate =
      overrideSamplingRate && overrideSamplingRate > 0
        ? overrideSamplingRate
        : extracted.samplingRate;

    // Branch: baseline comparison splits the extracted series in two
    // and analyzes each half independently. We keep the single-window
    // branch untouched as the default.
    const baselineOn = options.useBaselineComparison === true;
    const split = baselineOn
      ? splitExtractedByFraction(extracted, options.baselineFraction)
      : null;
    if (baselineOn && !split) {
      dispatch({ type: 'idle', reason: 'baseline-window-too-short' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (baselineOn && split) {
        runBaselineComparison({
          split,
          samplingRate,
          options,
          controller,
          retryToken,
          onLoading: (loadingExtracted) => dispatch({ type: 'loading', extracted: loadingExtracted }),
          onSuccess: ({ response, currentOutcome, baselineOutcome, rateLimit }) => {
            lastAnalyzedDataRef.current = data;
            dispatch({
              type: 'success',
              response,
              extracted: currentOutcome.extracted,
              analyzedAt: Date.now(),
              fromCache: currentOutcome.fromCache,
              rateLimit,
              baseline: baselineOutcome,
              referenceUsed: 'internal',
            });
          },
          onError: (err, errExtracted, retryAfter) =>
            dispatch({ type: 'error', error: err, extracted: errExtracted, retryAfter }),
        });
        return;
      }

      // Single-window path. In 'window-start' mode (the default) the
      // first `baselineFraction` of the window rides along as the
      // baseline and the verdict answers "did the recent part change vs
      // the start?" — still ONE analysis against quota. Windows too
      // short to split fall back to the engine's internal reference,
      // which reads healthy-but-dynamic signals (trends, periodicity)
      // as transition/unstable far more often.
      const wantWindowStart = options.referenceMode !== 'internal';
      const refSplit = wantWindowStart
        ? splitExtractedByFraction(extracted, options.baselineFraction)
        : null;
      const referenceUsed: ReferenceUsed = refSplit ? 'window-start' : 'internal';
      const cacheKey = buildCacheKey(
        hashSignal(extracted.values),
        samplingRate,
        options,
        `full:${referenceUsed}:${options.baselineFraction}`,
      );
      const cached = retryToken > 0 ? undefined : responseCache.get(cacheKey);
      if (cached) {
        lastAnalyzedDataRef.current = data;
        dispatch({
          type: 'success',
          response: cached.response,
          extracted,
          analyzedAt: Date.now(),
          fromCache: true,
          rateLimit: cached.rateLimit,
          baseline: null,
          referenceUsed,
        });
        return;
      }

      dispatch({ type: 'loading', extracted });

      void analyze(
        {
          signal: refSplit ? refSplit.current.values : extracted.values,
          baseline: refSplit ? refSplit.baseline.values : undefined,
          sampling_rate: samplingRate,
          domain: options.domain,
          include_semantic: options.includeSemantic,
          use_multiscale: options.useMultiscale,
        },
        {
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          abortSignal: controller.signal,
        },
      )
        .then((outcome) => {
          if (controller.signal.aborted) {
            return;
          }
          responseCache.set(cacheKey, outcome);
          lastAnalyzedDataRef.current = data;
          dispatch({
            type: 'success',
            response: outcome.response,
            extracted,
            analyzedAt: Date.now(),
            fromCache: false,
            rateLimit: outcome.rateLimit,
            baseline: null,
            referenceUsed,
          });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          const error = err instanceof Error ? err : new Error(String(err));
          const retryAfter =
            typeof (err as { retryAfter?: unknown })?.retryAfter === 'number'
              ? (err as { retryAfter: number }).retryAfter
              : null;
          dispatch({ type: 'error', error, extracted, retryAfter });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
    options.apiKey,
    options.baseUrl,
    options.domain,
    options.samplingRate,
    options.maxSignalSamples,
    options.useMultiscale,
    options.includeSemantic,
    options.refreshOnQuery,
    options.referenceMode,
    options.useBaselineComparison,
    options.baselineFraction,
    options.runOnDemand,
    retryToken,
    startToken,
  ]);

  return { state, retry, start };
}

/**
 * Run the baseline + current analyses in parallel. Both are cached
 * with role-scoped keys so the two sides don't collide. The exposed
 * `response` is the CURRENT analysis (what the user is looking at
 * "now"); `baseline` is attached as accompanying context for the
 * comparison UI.
 */
interface BaselineSplit {
  baseline: ExtractedSeries;
  current: ExtractedSeries;
}

interface RunBaselineArgs {
  split: BaselineSplit;
  samplingRate: number;
  options: CoreAnalysisOptions;
  controller: AbortController;
  retryToken: number;
  onLoading: (extracted: ExtractedSeries) => void;
  onSuccess: (args: {
    response: AnalyzeResponse;
    currentOutcome: { extracted: ExtractedSeries; fromCache: boolean };
    baselineOutcome: BaselineOutcome;
    rateLimit: RateLimitInfo | null;
  }) => void;
  onError: (err: Error, extracted: ExtractedSeries, retryAfter: number | null) => void;
}

function runBaselineComparison(args: RunBaselineArgs): void {
  const { split, samplingRate, options, controller, retryToken, onLoading, onSuccess, onError } = args;

  const currentKey = buildCacheKey(hashSignal(split.current.values), samplingRate, options, 'current');
  const baselineKey = buildCacheKey(hashSignal(split.baseline.values), samplingRate, options, 'baseline');
  const cachedCurrent = retryToken > 0 ? undefined : responseCache.get(currentKey);
  const cachedBaseline = retryToken > 0 ? undefined : responseCache.get(baselineKey);

  if (cachedCurrent && cachedBaseline) {
    onSuccess({
      response: cachedCurrent.response,
      currentOutcome: { extracted: split.current, fromCache: true },
      baselineOutcome: { response: cachedBaseline.response, extracted: split.baseline },
      rateLimit: cachedCurrent.rateLimit,
    });
    return;
  }

  onLoading(split.current);

  const analyzeCached = async (
    extracted: ExtractedSeries,
    cacheKey: string,
    cached: CachedOutcome | undefined,
  ) => {
    if (cached) {
      return cached;
    }
    const outcome = await analyze(
      {
        signal: extracted.values,
        sampling_rate: samplingRate,
        domain: options.domain,
        include_semantic: options.includeSemantic,
        use_multiscale: options.useMultiscale,
      },
      {
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        abortSignal: controller.signal,
      },
    );
    responseCache.set(cacheKey, outcome);
    return outcome;
  };

  Promise.all([
    analyzeCached(split.current, currentKey, cachedCurrent),
    analyzeCached(split.baseline, baselineKey, cachedBaseline),
  ])
    .then(([current, baseline]) => {
      if (controller.signal.aborted) {
        return;
      }
      onSuccess({
        response: current.response,
        currentOutcome: { extracted: split.current, fromCache: !!cachedCurrent },
        baselineOutcome: { response: baseline.response, extracted: split.baseline },
        rateLimit: current.rateLimit,
      });
    })
    .catch((err: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      const retryAfter =
        typeof (err as { retryAfter?: unknown })?.retryAfter === 'number'
          ? (err as { retryAfter: number }).retryAfter
          : null;
      onError(error, split.current, retryAfter);
    });
}

/**
 * Reset the module-level response cache. Exposed for tests.
 */
export function __resetAnalysisCache(): void {
  responseCache.clear();
}

/**
 * Check the API key format before spending a round-trip on it. Real
 * alphainfo keys start with `ai_` and are base64-ish; we just gate on
 * the prefix and a conservative minimum length so a pasted-wrong value
 * surfaces as "check the format" rather than a confusing 401.
 */
export function isLikelyValidKeyFormat(key: string): boolean {
  if (typeof key !== 'string') { return false; }
  const trimmed = key.trim();
  if (trimmed.length < 16) { return false; }
  return /^ai_[A-Za-z0-9_-]+$/.test(trimmed);
}
