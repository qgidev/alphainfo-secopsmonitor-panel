/**
 * Interpret the 5-dimensional structural fingerprint into one concrete
 * sentence a user can *act* on. The radar + numbers tell you "what"; this
 * helper tells you "what to do next".
 *
 * Inputs: the 5 sensitivities (each in [0, 1], higher = more preserved)
 * and the confidence band.
 *
 * Output: up to one short "what changed" line + one short "suggested
 * next step" line. Returns null when there's nothing meaningful to say
 * (fingerprint absent, confidence band stable with all sensitivities
 * preserved, etc.) — callers should hide the block in that case.
 *
 * Design notes:
 * - The interpretation is deliberately pattern-based, not ML. It reads
 *   "which sensitivity dropped the most relative to the others" and maps
 *   that to an action. This is correct for the common single-axis cases
 *   (step, drift, frequency switch) that drive most alerts, and safely
 *   degenerates to "compound change" for multi-axis drops.
 * - Copy is in use-language. No axis taxonomy leaks: we talk about
 *   "short-range", "long-range", "sharp transition" etc. — the same
 *   vocabulary the tooltips already use.
 * - Thresholds are conservative on purpose. We only fire the specific
 *   interpretation when the "dominant" axis is clearly distinguishable;
 *   otherwise we fall back to a compound message.
 */
import type { ConfidenceBand, FingerprintMetrics } from './types';

export interface FingerprintInterpretation {
  /** One-sentence description of the dominant structural change. */
  whatChanged: string;
  /** One-sentence suggested next step. */
  suggestedAction: string;
  /** The dominant axis key, for tests and data-attribute assertions. */
  dominantKey: keyof FingerprintMetrics | 'compound' | null;
}

/** Axis-specific copy. Keyed by the same field names as FingerprintMetrics. */
const AXIS_INTERPRETATION: Record<
  keyof FingerprintMetrics,
  { whatChanged: string; suggestedAction: string }
> = {
  sim_local: {
    whatChanged:
      'Short-range structure has shifted. The most recent samples look different from the baseline pattern.',
    suggestedAction:
      'Inspect the last few samples for spikes, steps, or missing data before escalating.',
  },
  sim_spectral: {
    whatChanged:
      'Medium-scale rhythm has changed. The periodic or repeating pattern no longer matches the baseline.',
    suggestedAction:
      'Check whether the process cadence (sampling interval, duty cycle, or schedule) has shifted.',
  },
  sim_fractal: {
    whatChanged:
      'Cross-scale roughness has changed. The signal is smoother or rougher than the baseline.',
    suggestedAction:
      'Compare input pre-processing or sensor filtering between the baseline and current windows.',
  },
  sim_transition: {
    whatChanged:
      'A sharp transition is present. There is a clear breakpoint or regime shift inside the window.',
    suggestedAction:
      'Locate the transition on the chart and correlate with deploys, config changes, or external events.',
  },
  sim_trend: {
    whatChanged:
      'Long-range trend has drifted. The overall baseline is moving away from where it used to be.',
    suggestedAction:
      'Extend the time range and verify whether the drift is gradual (normal) or accelerating (escalate).',
  },
};

const DOMINANT_MARGIN = 0.12; // how much lower the dominant axis must be vs the next lowest
const SENSITIVE_THRESHOLD = 0.75; // axes ≥ this are considered "preserved"

export function interpretFingerprint(
  metrics: FingerprintMetrics,
  band: ConfidenceBand,
): FingerprintInterpretation | null {
  // Stable band with all axes preserved: nothing to say.
  if (band === 'stable') {
    const allPreserved = (
      Object.values(metrics) as number[]
    ).every((v) => v >= SENSITIVE_THRESHOLD);
    if (allPreserved) {
      return null;
    }
  }

  const entries = (Object.entries(metrics) as Array<[keyof FingerprintMetrics, number]>)
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => a[1] - b[1]); // ascending: lowest first = most disrupted

  if (entries.length === 0) {
    return null;
  }

  const [dominant, second] = entries;
  const dominantValue = dominant[1];
  const secondValue = second?.[1] ?? 1;

  // If the lowest axis is still high, there's no real disruption to interpret.
  if (dominantValue >= SENSITIVE_THRESHOLD) {
    return null;
  }

  // If the two lowest axes are close, it's a compound change — don't
  // pretend we can attribute to a single dimension.
  if (secondValue - dominantValue < DOMINANT_MARGIN) {
    return {
      whatChanged:
        'Multiple structural dimensions shifted together. This is a compound change, not a single type of disruption.',
      suggestedAction:
        'Open the full time range and compare baseline vs current windows side-by-side before escalating.',
      dominantKey: 'compound',
    };
  }

  const { whatChanged, suggestedAction } = AXIS_INTERPRETATION[dominant[0]];
  return { whatChanged, suggestedAction, dominantKey: dominant[0] };
}

/**
 * Minimum delta magnitude (absolute difference) for a baseline
 * comparison to be considered meaningful. Below this, the axis is
 * treated as "unchanged" for interpretation purposes.
 */
const DELTA_NOISE_FLOOR = 0.05;

/**
 * Interpret a fingerprint *relative to a baseline*. Instead of asking
 * "which axis is low now?", this variant asks "which axis moved the
 * most from baseline to now?" — which is a more direct answer to the
 * operator's usual question during an incident.
 *
 * The logic is parallel to `interpretFingerprint`:
 *   - All axes stable (|Δ| < noise floor) → null (nothing to say)
 *   - One axis moved significantly more than the rest → attribute it
 *   - Two or more axes moved together → compound change
 *
 * The direction (drop vs rise) matters for the copy: a drop in a
 * sensitivity means disruption; a rise means recovery / smoothing.
 * For now we focus on drops (the common incident case). Rises return
 * a stabilization-style message.
 */
export function interpretFingerprintWithBaseline(
  current: FingerprintMetrics,
  baseline: FingerprintMetrics,
  band: ConfidenceBand,
): FingerprintInterpretation | null {
  const deltas = (Object.keys(current) as Array<keyof FingerprintMetrics>).map((k) => ({
    key: k,
    now: current[k],
    was: baseline[k],
    delta: current[k] - baseline[k],
  }));

  const significant = deltas.filter((d) => Math.abs(d.delta) >= DELTA_NOISE_FLOOR);

  // Nothing moved enough to talk about — if the band is also stable,
  // keep quiet. Otherwise fall back to the single-fingerprint logic
  // so unusual patterns (band unstable, deltas small, but absolute
  // values low) still produce an interpretation.
  if (significant.length === 0) {
    if (band === 'stable') {
      return null;
    }
    return interpretFingerprint(current, band);
  }

  // Sort by magnitude of change, biggest first.
  significant.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = significant[0];
  const runnerUp = significant[1];

  // Compound: two axes moved comparably.
  if (
    runnerUp &&
    Math.abs(Math.abs(top.delta) - Math.abs(runnerUp.delta)) < DELTA_NOISE_FLOOR
  ) {
    return {
      whatChanged:
        'Multiple structural dimensions shifted together compared to the baseline window. This is a compound change, not a single type of disruption.',
      suggestedAction:
        'Open the full time range and compare baseline vs current windows side-by-side before escalating.',
      dominantKey: 'compound',
    };
  }

  const base = AXIS_INTERPRETATION[top.key];
  if (top.delta < 0) {
    // Drop — incident-style framing, reuse the existing copy.
    return {
      whatChanged: base.whatChanged,
      suggestedAction: base.suggestedAction,
      dominantKey: top.key,
    };
  }

  // Rise — the structure is *more* preserved than the baseline.
  // Usually "the system stabilized", which is worth surfacing.
  return {
    whatChanged:
      'Structure is more preserved now than in the baseline window. The system appears to have stabilized along one dimension.',
    suggestedAction:
      'If this follows a recent action (deploy, config, fix), confirm the action and document what changed.',
    dominantKey: top.key,
  };
}
