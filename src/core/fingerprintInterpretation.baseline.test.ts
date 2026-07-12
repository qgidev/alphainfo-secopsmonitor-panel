import { interpretFingerprintWithBaseline } from './fingerprintInterpretation';
import type { FingerprintMetrics } from './types';

/**
 * Tests for interpretFingerprintWithBaseline. The function asks
 * "which axis moved the most vs baseline?" instead of "which axis
 * is low now?" — see the docstring in fingerprintInterpretation.ts.
 */
describe('interpretFingerprintWithBaseline', () => {
  const mk = (overrides: Partial<FingerprintMetrics> = {}): FingerprintMetrics => ({
    sim_local: 0.9,
    sim_spectral: 0.9,
    sim_fractal: 0.9,
    sim_transition: 0.9,
    sim_trend: 0.9,
    ...overrides,
  });

  it('returns null when band is stable and deltas are all below the noise floor', () => {
    const current = mk({ sim_local: 0.91, sim_transition: 0.89 });
    const baseline = mk();
    expect(interpretFingerprintWithBaseline(current, baseline, 'stable')).toBeNull();
  });

  it('attributes a clear transition-axis drop to the transition key', () => {
    const current = mk({ sim_transition: 0.3 });
    const baseline = mk();
    const out = interpretFingerprintWithBaseline(current, baseline, 'unstable');
    expect(out?.dominantKey).toBe('sim_transition');
    expect(out?.whatChanged).toMatch(/sharp transition|breakpoint/i);
  });

  it('picks the axis with the largest absolute movement, not the lowest current value', () => {
    // D1 current is lower (0.55) but dropped only 0.05 from baseline (0.60).
    // D5 current is higher (0.50) but dropped 0.40 from baseline (0.90).
    // The baseline-aware interpreter must attribute to D5.
    const current = mk({ sim_local: 0.55, sim_trend: 0.5 });
    const baseline = mk({ sim_local: 0.6, sim_trend: 0.9 });
    const out = interpretFingerprintWithBaseline(current, baseline, 'transition');
    expect(out?.dominantKey).toBe('sim_trend');
  });

  it('detects compound change when two axes move comparably', () => {
    const current = mk({ sim_local: 0.4, sim_transition: 0.45 });
    const baseline = mk();
    const out = interpretFingerprintWithBaseline(current, baseline, 'unstable');
    expect(out?.dominantKey).toBe('compound');
  });

  it('surfaces a stabilization message when the structure rose past the noise floor', () => {
    // Axes improved significantly — the system is more structurally
    // preserved now than during the baseline window.
    const current = mk({ sim_transition: 0.95 });
    const baseline = mk({ sim_transition: 0.4 });
    const out = interpretFingerprintWithBaseline(current, baseline, 'stable');
    expect(out?.dominantKey).toBe('sim_transition');
    expect(out?.whatChanged).toMatch(/stabilized|preserved/i);
    expect(out?.suggestedAction).toMatch(/deploy|config|fix/i);
  });

  it('falls back to single-fingerprint interpretation when deltas are noise but band is unstable', () => {
    // Current scores are globally low but deltas vs baseline are small
    // → baseline-aware path bails out, single-fingerprint path attributes.
    // Since all axes are low and spaced close together (<DOMINANT_MARGIN),
    // that fallback path produces 'compound' — the correct answer.
    const current = mk({ sim_local: 0.3, sim_spectral: 0.35, sim_fractal: 0.4, sim_transition: 0.45, sim_trend: 0.5 });
    const baseline = mk({ sim_local: 0.32, sim_spectral: 0.37, sim_fractal: 0.42, sim_transition: 0.46, sim_trend: 0.51 });
    const out = interpretFingerprintWithBaseline(current, baseline, 'unstable');
    expect(out).not.toBeNull();
    expect(out?.dominantKey).toBe('compound');
  });

  it('falls back to single-fingerprint interpretation and attributes a clear single-axis case', () => {
    // One axis dominantly low, the rest close to 1 → fallback should
    // attribute to that one axis, not compound.
    const current = mk({ sim_transition: 0.2 });
    const baseline = mk({ sim_transition: 0.22 }); // delta within noise floor
    const out = interpretFingerprintWithBaseline(current, baseline, 'unstable');
    expect(out?.dominantKey).toBe('sim_transition');
  });

  it('returns null when band is stable and deltas are noise (nothing worth saying)', () => {
    const current = mk({ sim_local: 0.91 });
    const baseline = mk({ sim_local: 0.89 });
    expect(interpretFingerprintWithBaseline(current, baseline, 'stable')).toBeNull();
  });
});
