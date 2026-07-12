import { useEffect, useReducer } from 'react';
import { analyzeBatch, type RateLimitInfo } from './client';
import type { CoreAnalysisOptions } from './analysisOptions';
import { TTLCache } from './cache';
import { hashSignal, splitExtractedByFraction, type ExtractedSeries } from './dataTransform';
import {
  assembleDeepTimeline,
  clampWindowCount,
  sliceWindows,
  type DeepTimelineResult,
} from './windowing';

/**
 * Deep-mode companion to `useAlphaInfoAnalysis`. Runs only after the
 * headline analysis succeeded (the caller passes that run's extracted
 * series), so manual/on-demand gating automatically applies to deep mode
 * too — one click spends `1 + windowCount` analyses, never more.
 */
export type DeepState =
  | { status: 'off' }
  /** Series cannot yield 2+ windows of the engine minimum (10 samples). */
  | { status: 'too-short' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | {
      status: 'success';
      timeline: DeepTimelineResult;
      rateLimit: RateLimitInfo | null;
      fromCache: boolean;
    };

interface CachedDeep {
  timeline: DeepTimelineResult;
  rateLimit: RateLimitInfo | null;
}

/** Same TTL policy as the headline response cache (30 s). */
const deepCache = new TTLCache<CachedDeep>(30_000);

const DEBOUNCE_MS = 500;

export interface UseDeepTimelineInput {
  /** Extracted series of the SUCCESSFUL headline analysis; null while
   *  the headline is idle/loading/errored. */
  extracted: ExtractedSeries | null;
  samplingRate: number;
  options: CoreAnalysisOptions;
}

type Action =
  | { type: 'reset'; to: DeepState['status'] & ('off' | 'too-short' | 'loading') }
  | { type: 'error'; error: Error }
  | { type: 'success'; timeline: DeepTimelineResult; rateLimit: RateLimitInfo | null; fromCache: boolean };

function reducer(_: DeepState, action: Action): DeepState {
  switch (action.type) {
    case 'reset':
      return { status: action.to };
    case 'error':
      return { status: 'error', error: action.error };
    case 'success':
      return {
        status: 'success',
        timeline: action.timeline,
        rateLimit: action.rateLimit,
        fromCache: action.fromCache,
      };
  }
}

export function useDeepTimeline(input: UseDeepTimelineInput): DeepState {
  const [state, dispatch] = useReducer(reducer, { status: 'off' });
  const { extracted, samplingRate, options } = input;
  const windowCount = clampWindowCount(options.deepWindowCount);

  useEffect(() => {
    if (!options.deepMode || !extracted) {
      dispatch({ type: 'reset', to: 'off' });
      return;
    }
    const windows = sliceWindows(extracted.values, windowCount);
    if (!windows) {
      dispatch({ type: 'reset', to: 'too-short' });
      return;
    }

    // Mirror the headline call's reference: in window-start mode every
    // window is compared against the first `baselineFraction` of the
    // window, so per-window scores line up with the badge verdict and
    // pre-change windows read stable instead of self-inconsistent.
    const refSplit =
      options.referenceMode !== 'internal'
        ? splitExtractedByFraction(extracted, options.baselineFraction)
        : null;
    const baselines = refSplit ? windows.map(() => refSplit.baseline.values) : undefined;

    const cacheKey = [
      hashSignal(extracted.values),
      samplingRate.toFixed(4),
      options.domain,
      options.useMultiscale ? '1' : '0',
      options.baseUrl,
      `deep:${windows.length}:${refSplit ? `ws:${options.baselineFraction}` : 'int'}`,
    ].join('|');

    const cached = deepCache.get(cacheKey);
    if (cached) {
      dispatch({ type: 'success', ...cached, fromCache: true });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      dispatch({ type: 'reset', to: 'loading' });
      void analyzeBatch(
        {
          signals: windows.map((w) => w.values),
          baselines,
          sampling_rate: samplingRate,
          domain: options.domain,
          // Headline call already carries the semantic layer; skipping it
          // here keeps the batch payload and response lean.
          include_semantic: false,
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
          const timeline = assembleDeepTimeline(
            windows,
            outcome.response.results,
            outcome.response.analyses_consumed,
          );
          deepCache.set(cacheKey, { timeline, rateLimit: outcome.rateLimit });
          dispatch({ type: 'success', timeline, rateLimit: outcome.rateLimit, fromCache: false });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          dispatch({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    extracted,
    samplingRate,
    options.deepMode,
    windowCount,
    options.domain,
    options.useMultiscale,
    options.apiKey,
    options.baseUrl,
    options.referenceMode,
    options.baselineFraction,
  ]);

  return state;
}

/** Reset the module-level deep cache. Exposed for tests. */
export function __resetDeepCache(): void {
  deepCache.clear();
}
