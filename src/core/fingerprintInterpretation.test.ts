import { interpretFingerprint } from './fingerprintInterpretation';
import type { FingerprintMetrics } from './types';

describe('interpretFingerprint', () => {
  const fully = (overrides: Partial<FingerprintMetrics> = {}): FingerprintMetrics => ({
    sim_local: 0.95,
    sim_spectral: 0.95,
    sim_fractal: 0.95,
    sim_transition: 0.95,
    sim_trend: 0.95,
    ...overrides,
  });

  it('returns null when band is stable and all axes are preserved', () => {
    expect(interpretFingerprint(fully(), 'stable')).toBeNull();
  });

  it('returns null when no axis is meaningfully disrupted', () => {
    // All axes above the sensitivity threshold (0.75) → nothing to say,
    // even if the band happens to be transition.
    const result = interpretFingerprint(fully({ sim_local: 0.82 }), 'transition');
    expect(result).toBeNull();
  });

  it('attributes a step/breakpoint to the transition axis', () => {
    const result = interpretFingerprint(
      fully({ sim_transition: 0.3 }),
      'unstable',
    );
    expect(result?.dominantKey).toBe('sim_transition');
    expect(result?.whatChanged).toMatch(/sharp transition|breakpoint/i);
    expect(result?.suggestedAction).toMatch(/deploy|config|correlate/i);
  });

  it('attributes a short-range disruption to the local axis', () => {
    const result = interpretFingerprint(
      fully({ sim_local: 0.2 }),
      'unstable',
    );
    expect(result?.dominantKey).toBe('sim_local');
    expect(result?.whatChanged).toMatch(/short-range|recent/i);
  });

  it('attributes a drift to the long-range axis', () => {
    const result = interpretFingerprint(
      fully({ sim_trend: 0.35 }),
      'transition',
    );
    expect(result?.dominantKey).toBe('sim_trend');
    expect(result?.whatChanged).toMatch(/long-range|drift|baseline/i);
  });

  it('falls back to compound when two axes dropped together', () => {
    const result = interpretFingerprint(
      fully({ sim_local: 0.35, sim_transition: 0.4 }),
      'unstable',
    );
    expect(result?.dominantKey).toBe('compound');
    expect(result?.whatChanged).toMatch(/compound|multiple/i);
  });

  it('uses use-language only (no taxonomy leak in copy)', () => {
    const allCopies = (
      [
        fully({ sim_local: 0.2 }),
        fully({ sim_spectral: 0.2 }),
        fully({ sim_fractal: 0.2 }),
        fully({ sim_transition: 0.2 }),
        fully({ sim_trend: 0.2 }),
        fully({ sim_local: 0.3, sim_transition: 0.35 }),
      ].map((m) => interpretFingerprint(m, 'unstable'))
    ).filter((x): x is NonNullable<typeof x> => x !== null);

    // Regression guard: no copy should expose the field-name suffixes.
    for (const r of allCopies) {
      for (const leak of ['Local', 'Spectral', 'Fractal', 'Transition', 'Trend', 'sim_']) {
        expect(r.whatChanged).not.toMatch(new RegExp(`\\b${leak}\\b`));
        expect(r.suggestedAction).not.toMatch(new RegExp(`\\b${leak}\\b`));
      }
    }
  });
});
