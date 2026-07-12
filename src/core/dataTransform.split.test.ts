import { splitExtractedByFraction, type ExtractedSeries } from './dataTransform';

/**
 * Tests for splitExtractedByFraction — the helper that powers
 * baseline comparison by cutting an already-extracted series into
 * baseline (first part) + current (second part) according to a
 * fraction in (0.1, 0.9).
 */
describe('splitExtractedByFraction', () => {
  const makeExtracted = (length: number): ExtractedSeries => ({
    values: Array.from({ length }, (_, i) => i),
    samplingRate: 10,
    fieldName: 'test',
    timeRange: { from: 1_000_000, to: 1_000_000 + length * 100 },
    interpolatedCount: 20,
    downsampledFrom: 0,
  });

  it('splits evenly at 0.5 by default', () => {
    const split = splitExtractedByFraction(makeExtracted(100), 0.5);
    expect(split).not.toBeNull();
    expect(split!.baseline.values.length).toBe(50);
    expect(split!.current.values.length).toBe(50);
    // Baseline gets the first half, current gets the second
    expect(split!.baseline.values[0]).toBe(0);
    expect(split!.current.values[0]).toBe(50);
  });

  it('respects asymmetric fractions and preserves order', () => {
    const split = splitExtractedByFraction(makeExtracted(100), 0.25);
    expect(split).not.toBeNull();
    expect(split!.baseline.values.length).toBe(25);
    expect(split!.current.values.length).toBe(75);
    expect(split!.current.values[0]).toBe(25);
  });

  it('clamps fractions outside (0.1, 0.9)', () => {
    // 0.01 → clamped to 0.1, so baseline = 10 samples
    const low = splitExtractedByFraction(makeExtracted(100), 0.01);
    expect(low!.baseline.values.length).toBe(10);
    // 0.99 → clamped to 0.9, so baseline = 90 samples
    const high = splitExtractedByFraction(makeExtracted(100), 0.99);
    expect(high!.baseline.values.length).toBe(90);
  });

  it('returns null when either half would fall below the minimum', () => {
    // 15 samples at fraction 0.5 → baseline 8, current 7, both below 10
    expect(splitExtractedByFraction(makeExtracted(15), 0.5)).toBeNull();
    // 100 samples at fraction 0.05 → clamped to 0.1 → baseline 10, current 90 — passes
    expect(splitExtractedByFraction(makeExtracted(100), 0.05)).not.toBeNull();
  });

  it('splits the timeRange proportionally', () => {
    const src = makeExtracted(100); // from=1_000_000, to=1_010_000
    const split = splitExtractedByFraction(src, 0.5);
    expect(split!.baseline.timeRange).toEqual({ from: 1_000_000, to: 1_005_000 });
    expect(split!.current.timeRange).toEqual({ from: 1_005_000, to: 1_010_000 });
  });

  it('returns null timeRange on halves when parent has no timeRange', () => {
    const noTime = { ...makeExtracted(100), timeRange: null };
    const split = splitExtractedByFraction(noTime, 0.5);
    expect(split!.baseline.timeRange).toBeNull();
    expect(split!.current.timeRange).toBeNull();
  });

  it('copies samplingRate and fieldName to both halves', () => {
    const split = splitExtractedByFraction(makeExtracted(100), 0.5);
    expect(split!.baseline.samplingRate).toBe(10);
    expect(split!.current.samplingRate).toBe(10);
    expect(split!.baseline.fieldName).toBe('test');
    expect(split!.current.fieldName).toBe('test');
  });

  it('resets downsampledFrom on halves (they were not individually downsampled)', () => {
    const src = { ...makeExtracted(100), downsampledFrom: 200_000 };
    const split = splitExtractedByFraction(src, 0.5);
    expect(split!.baseline.downsampledFrom).toBe(0);
    expect(split!.current.downsampledFrom).toBe(0);
  });
});
