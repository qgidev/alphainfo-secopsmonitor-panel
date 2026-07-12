import { DataFrame, Field, FieldType } from '@grafana/data';

export interface ExtractedSeries {
  /** Numeric samples ready to send as the `signal` field. */
  values: number[];
  /** Sampling rate in Hz; derived from the time field when present. */
  samplingRate: number;
  /** Name of the numeric field that was extracted. */
  fieldName: string;
  /** Epoch-ms timestamp range of the series, or null if no time field. */
  timeRange: { from: number; to: number } | null;
  /** Number of samples linearly interpolated to bridge small gaps. */
  interpolatedCount: number;
  /** When > 0, the original length before uniform downsampling to maxSamples. */
  downsampledFrom: number;
}

export interface ExtractOptions {
  /** Fallback sampling rate (Hz) when no time field is present. */
  fallbackSamplingRate?: number;
  /** alphainfo hard minimum is 10 samples; server rejects below this. */
  minSamples?: number;
  /** Reject if more than this fraction of the nominal series is missing. */
  maxGapFraction?: number;
  /** Reject if any single gap exceeds this many samples, regardless of total. */
  maxSingleGapSamples?: number;
  /**
   * Uniformly downsample to at most this many samples before returning.
   * Tier-dependent: Starter 100k, Growth 500k, Pro 1M, Enterprise 5M.
   * When triggered, `downsampledFrom` carries the original length and
   * `samplingRate` is rescaled so the time span stays consistent.
   */
  maxSamples?: number;
}

const DEFAULT_MIN_SAMPLES = 10;
const DEFAULT_MAX_GAP_FRACTION = 0.05;
const DEFAULT_MAX_SINGLE_GAP_SAMPLES = 10;
/**
 * Conservative default sized for the alphainfo Free tier (hard cap 10k).
 * Paying tiers (Starter 100k / Growth 500k / Pro 1M / Enterprise 5M) should
 * override via the panel option — we'd rather ship with a default that
 * works everywhere than one that fails for the largest user segment.
 */
const DEFAULT_MAX_SAMPLES = 9_500;

/**
 * Extract the first numeric series from a DataFrame, align it with the time
 * field (when present), analyze gaps, and linearly interpolate small gaps.
 * Returns null when the frame has no numeric field, the cleaned series is
 * shorter than `minSamples`, or the gap fraction exceeds `maxGapFraction`.
 *
 * Policy for gaps:
 *   - Drop any (time, value) pair where either is non-finite.
 *   - Infer nominal cadence from the median of consecutive time deltas.
 *   - Linearly interpolate gaps up to `maxSingleGapSamples` wide.
 *   - Reject the frame if total missing fraction exceeds `maxGapFraction`.
 */
export function extractNumericSeries(
  frame: DataFrame,
  options: ExtractOptions = {},
): ExtractedSeries | null {
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  const maxGapFraction = options.maxGapFraction ?? DEFAULT_MAX_GAP_FRACTION;
  const maxSingleGapSamples = options.maxSingleGapSamples ?? DEFAULT_MAX_SINGLE_GAP_SAMPLES;
  const maxSamples = Math.max(minSamples, options.maxSamples ?? DEFAULT_MAX_SAMPLES);

  if (!frame.fields || frame.fields.length === 0) {
    return null;
  }

  const numericField = frame.fields.find((f) => f.type === FieldType.number);
  if (!numericField) {
    return null;
  }
  const timeField = frame.fields.find((f) => f.type === FieldType.time);

  const aligned = alignAndDropNonFinite(numericField, timeField);
  if (aligned.values.length < minSamples) {
    return null;
  }

  let result: ExtractedSeries;

  if (!timeField || aligned.times.length < 2) {
    const samplingRate =
      options.fallbackSamplingRate && options.fallbackSamplingRate > 0
        ? options.fallbackSamplingRate
        : 1;
    result = {
      values: aligned.values,
      samplingRate,
      fieldName: numericField.name,
      timeRange: null,
      interpolatedCount: 0,
      downsampledFrom: 0,
    };
  } else {
    const gaps = analyzeGaps(aligned.times);
    if (gaps.medianDelta <= 0) {
      result = {
        values: aligned.values,
        samplingRate:
          options.fallbackSamplingRate && options.fallbackSamplingRate > 0
            ? options.fallbackSamplingRate
            : 1,
        fieldName: numericField.name,
        timeRange: { from: aligned.times[0], to: aligned.times[aligned.times.length - 1] },
        interpolatedCount: 0,
        downsampledFrom: 0,
      };
    } else {
      const nominalLength = aligned.values.length + gaps.totalMissing;
      const missingFraction = nominalLength > 0 ? gaps.totalMissing / nominalLength : 0;
      if (missingFraction > maxGapFraction || gaps.largestGapSamples > maxSingleGapSamples) {
        return null;
      }

      const interpolated =
        gaps.totalMissing > 0
          ? linearlyInterpolateGaps(aligned.times, aligned.values, gaps.medianDelta)
          : aligned.values;

      result = {
        values: interpolated,
        samplingRate: 1000 / gaps.medianDelta, // Grafana time fields are ms epoch
        fieldName: numericField.name,
        timeRange: { from: aligned.times[0], to: aligned.times[aligned.times.length - 1] },
        interpolatedCount: interpolated.length - aligned.values.length,
        downsampledFrom: 0,
      };
    }
  }

  // Uniform downsample if the series exceeds the configured cap. Rescale
  // the sampling rate so the time span represented stays consistent with
  // what we'll send to the API.
  if (result.values.length > maxSamples) {
    const originalLength = result.values.length;
    const downsampled = uniformDownsample(result.values, maxSamples);
    const scale = downsampled.length / originalLength;
    result = {
      ...result,
      values: downsampled,
      samplingRate: result.samplingRate * scale,
      downsampledFrom: originalLength,
    };
  }

  return result;
}

function uniformDownsample(values: number[], target: number): number[] {
  if (values.length <= target || target < 2) {
    return values.slice();
  }
  const out: number[] = new Array(target);
  const denom = target - 1;
  const srcMax = values.length - 1;
  for (let i = 0; i < target; i++) {
    // even spacing across the original range, including both endpoints
    const idx = Math.round((i * srcMax) / denom);
    out[i] = values[idx];
  }
  return out;
}

function alignAndDropNonFinite(
  numericField: Field,
  timeField: Field | undefined,
): { times: number[]; values: number[] } {
  const valsRaw = numericField.values;
  const timesRaw = timeField ? timeField.values : undefined;
  const len = typeof valsRaw.length === 'number' ? valsRaw.length : 0;
  const times: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < len; i++) {
    const v = typeof valsRaw[i] === 'number' ? valsRaw[i] : Number(valsRaw[i]);
    if (!Number.isFinite(v)) {
      continue;
    }
    if (timesRaw) {
      const t = typeof timesRaw[i] === 'number' ? timesRaw[i] : Number(timesRaw[i]);
      if (!Number.isFinite(t)) {
        continue;
      }
      times.push(t);
    }
    values.push(v);
  }
  return { times, values };
}

interface GapStats {
  medianDelta: number;
  totalMissing: number;
  largestGapSamples: number;
}

function analyzeGaps(times: number[]): GapStats {
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0) {
      deltas.push(d);
    }
  }
  if (deltas.length === 0) {
    return { medianDelta: 0, totalMissing: 0, largestGapSamples: 0 };
  }
  const medianDelta = median(deltas);
  if (medianDelta <= 0) {
    return { medianDelta: 0, totalMissing: 0, largestGapSamples: 0 };
  }
  let totalMissing = 0;
  let largestGapSamples = 0;
  for (const d of deltas) {
    const k = Math.max(1, Math.round(d / medianDelta));
    const missing = k - 1;
    totalMissing += missing;
    if (missing > largestGapSamples) {
      largestGapSamples = missing;
    }
  }
  return { medianDelta, totalMissing, largestGapSamples };
}

function median(nums: number[]): number {
  if (nums.length === 0) {
    return 0;
  }
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function linearlyInterpolateGaps(
  times: number[],
  values: number[],
  medianDelta: number,
): number[] {
  const out: number[] = [values[0]];
  for (let i = 1; i < times.length; i++) {
    const delta = times[i] - times[i - 1];
    const k = Math.max(1, Math.round(delta / medianDelta));
    if (k > 1) {
      const step = (values[i] - values[i - 1]) / k;
      for (let j = 1; j < k; j++) {
        out.push(values[i - 1] + step * j);
      }
    }
    out.push(values[i]);
  }
  return out;
}

/**
 * Split an already-extracted series into baseline + current halves
 * using a fraction of the total length. The baseline is the first
 * `fraction` of the series, current is the rest. Both halves inherit
 * the parent's `samplingRate`, `fieldName`, and `downsampledFrom`;
 * `timeRange` is split proportionally, `interpolatedCount` is
 * distributed pro-rata.
 *
 * Returns null when either half would be below the engine's hard
 * minimum (10 samples per the alphainfo contract). Callers should
 * surface this to the user as "time range too short for baseline
 * comparison — expand the window".
 */
export function splitExtractedByFraction(
  extracted: ExtractedSeries,
  fraction: number,
  minSamples: number = DEFAULT_MIN_SAMPLES,
): { baseline: ExtractedSeries; current: ExtractedSeries } | null {
  const clamped = Math.max(0.1, Math.min(0.9, fraction));
  const pivot = Math.round(extracted.values.length * clamped);
  const baselineValues = extracted.values.slice(0, pivot);
  const currentValues = extracted.values.slice(pivot);
  if (baselineValues.length < minSamples || currentValues.length < minSamples) {
    return null;
  }
  const baselineRange = extracted.timeRange
    ? {
        from: extracted.timeRange.from,
        to: Math.round(
          extracted.timeRange.from +
            (extracted.timeRange.to - extracted.timeRange.from) * clamped,
        ),
      }
    : null;
  const currentRange = extracted.timeRange
    ? { from: baselineRange!.to, to: extracted.timeRange.to }
    : null;
  return {
    baseline: {
      values: baselineValues,
      samplingRate: extracted.samplingRate,
      fieldName: extracted.fieldName,
      timeRange: baselineRange,
      interpolatedCount: Math.round(extracted.interpolatedCount * clamped),
      downsampledFrom: 0,
    },
    current: {
      values: currentValues,
      samplingRate: extracted.samplingRate,
      fieldName: extracted.fieldName,
      timeRange: currentRange,
      interpolatedCount: Math.round(extracted.interpolatedCount * (1 - clamped)),
      downsampledFrom: 0,
    },
  };
}

/**
 * Deterministic hash of a numeric signal for cache-key composition.
 * FNV-1a 32-bit over quantized samples; collisions are acceptable since the
 * cache key also includes sampling_rate and domain.
 */
export function hashSignal(values: number[]): string {
  let h = 2166136261;
  for (let i = 0; i < values.length; i++) {
    const q = Math.floor(values[i] * 1000);
    h = (h ^ (q & 0xffffffff)) >>> 0;
    h = Math.imul(h, 16777619);
  }
  return h.toString(16).padStart(8, '0');
}
