import type { AnalyzeResponse, FingerprintMetrics } from './types';

/**
 * The API returns `metrics` as a loose record; this narrows to a typed
 * FingerprintMetrics only if all five sim_* fields are present as finite
 * numbers AND `fingerprint_available` is not explicitly false. When any
 * are missing, callers render the fallback explainer instead.
 */
export function toFingerprintMetrics(metrics: unknown): FingerprintMetrics | null {
  if (typeof metrics !== 'object' || metrics === null) {
    return null;
  }
  const rec = metrics as Record<string, unknown>;
  if (rec.fingerprint_available === false) {
    return null; // server told us it's not available; don't second-guess
  }
  const keys: Array<keyof FingerprintMetrics> = [
    'sim_local',
    'sim_spectral',
    'sim_fractal',
    'sim_transition',
    'sim_trend',
  ];
  const out: Partial<FingerprintMetrics> = {};
  for (const k of keys) {
    const v = rec[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return null;
    }
    out[k] = v;
  }
  return out as FingerprintMetrics;
}

/**
 * Safely pull `metrics._note` out of the loose metrics record. The engine
 * only emits it when it has specific context to share (e.g., "Constant
 * signal: perfectly stable (zero variance)").
 */
export function extractEngineNote(metrics: AnalyzeResponse['metrics']): string | null {
  if (!metrics) {
    return null;
  }
  const note = (metrics as Record<string, unknown>)._note;
  if (typeof note !== 'string') {
    return null;
  }
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : null;
}
