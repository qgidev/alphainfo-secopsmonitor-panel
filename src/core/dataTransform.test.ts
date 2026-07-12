import { DataFrame, Field, FieldType } from '@grafana/data';
import { extractNumericSeries, hashSignal } from './dataTransform';

function makeFrame(
  fields: Array<Partial<Field> & Pick<Field, 'name' | 'type' | 'values'>>,
): DataFrame {
  return {
    length: fields[0]?.values.length ?? 0,
    fields: fields.map((f) => ({ config: {}, ...f })) as Field[],
  };
}

describe('extractNumericSeries', () => {
  it('returns null when the frame has no fields', () => {
    expect(extractNumericSeries({ length: 0, fields: [] })).toBeNull();
  });

  it('returns null when there is no numeric field', () => {
    const frame = makeFrame([
      { name: 'label', type: FieldType.string, values: ['a', 'b', 'c'] },
    ]);
    expect(extractNumericSeries(frame)).toBeNull();
  });

  it('rejects series shorter than the minimum sample count', () => {
    const frame = makeFrame([
      { name: 'v', type: FieldType.number, values: [1, 2, 3, 4, 5] },
    ]);
    expect(extractNumericSeries(frame)).toBeNull();
  });

  it('extracts the first numeric field and derives sampling rate from median delta', () => {
    const times = Array.from({ length: 13 }, (_, i) => i * 1000); // 1 Hz
    const values = times.map((_, i) => i * 0.5);
    const frame = makeFrame([
      { name: 'time', type: FieldType.time, values: times },
      { name: 'value', type: FieldType.number, values },
    ]);

    const out = extractNumericSeries(frame);
    expect(out).not.toBeNull();
    expect(out!.values).toHaveLength(13);
    expect(out!.fieldName).toBe('value');
    expect(out!.samplingRate).toBeCloseTo(1, 3);
    expect(out!.timeRange).toEqual({ from: 0, to: 12000 });
    expect(out!.interpolatedCount).toBe(0);
  });

  it('uses the fallback sampling rate when no time field is present', () => {
    const frame = makeFrame([
      {
        name: 'value',
        type: FieldType.number,
        values: Array.from({ length: 20 }, (_, i) => i),
      },
    ]);
    const out = extractNumericSeries(frame, { fallbackSamplingRate: 250 });
    expect(out).not.toBeNull();
    expect(out!.samplingRate).toBe(250);
    expect(out!.timeRange).toBeNull();
    expect(out!.interpolatedCount).toBe(0);
  });

  it('drops NaN/Inf samples together with their timestamps and interpolates them', () => {
    const values: number[] = [1, 2, NaN, 3, Infinity, 4, 5, 6, 7, 8, 9, 10, 11];
    const times = values.map((_, i) => i * 1000);
    const frame = makeFrame([
      { name: 'time', type: FieldType.time, values: times },
      { name: 'value', type: FieldType.number, values },
    ]);
    // The test input is ~15% non-finite, above the default 5% rejection
    // threshold. Relax the threshold here to exercise the interpolation path.
    const out = extractNumericSeries(frame, { maxGapFraction: 0.25 });
    expect(out).not.toBeNull();
    // After dropping NaN and Inf, two gaps of 1 sample each remain; both get
    // linearly interpolated back to a uniform 13-sample series.
    expect(out!.values).toHaveLength(13);
    expect(out!.interpolatedCount).toBe(2);
    expect(out!.values[2]).toBeCloseTo(2.5, 3); // between 2 and 3
  });

  it('rejects frames where NaN/Inf drops exceed the default gap threshold', () => {
    // Same pattern above without the relaxed threshold is rejected.
    const values: number[] = [1, 2, NaN, 3, Infinity, 4, 5, 6, 7, 8, 9, 10, 11];
    const times = values.map((_, i) => i * 1000);
    const frame = makeFrame([
      { name: 'time', type: FieldType.time, values: times },
      { name: 'value', type: FieldType.number, values },
    ]);
    expect(extractNumericSeries(frame)).toBeNull();
  });

  it('linearly interpolates small time-axis gaps', () => {
    // Timeline with a 2-sample gap: [0, 1, 2, _, _, 5, 6, 7, 8, 9, 10, 11, 12] (seconds)
    const times = [0, 1000, 2000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000];
    const values = [10, 20, 30, 60, 70, 80, 90, 100, 110, 120, 130, 140];
    const frame = makeFrame([
      { name: 'time', type: FieldType.time, values: times },
      { name: 'value', type: FieldType.number, values },
    ]);
    const out = extractNumericSeries(frame, { maxGapFraction: 0.25 });
    expect(out).not.toBeNull();
    expect(out!.interpolatedCount).toBe(2);
    // The inserted samples should be 40 and 50 (linear interp between 30 and 60).
    expect(out!.values).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140]);
  });

  it('rejects frames with more than maxGapFraction missing', () => {
    // 12 samples with one 10-sample gap => 10/22 ≈ 45% missing, over default 5%.
    const times = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000];
    const values = Array.from({ length: times.length }, (_, i) => i);
    const frame = makeFrame([
      { name: 'time', type: FieldType.time, values: times },
      { name: 'value', type: FieldType.number, values },
    ]);
    expect(extractNumericSeries(frame)).toBeNull();
  });

  it('rejects frames where a single gap is larger than maxSingleGapSamples', () => {
    // 100 samples, one 20-sample gap. Fraction is low (≈17%) but single gap is large.
    const times = Array.from({ length: 100 }, (_, i) => i * 1000);
    times[50] = 70_000; // creates a 20-sample gap
    const values = times.map((_, i) => i);
    const frame = makeFrame([
      { name: 'time', type: FieldType.time, values: times },
      { name: 'value', type: FieldType.number, values },
    ]);
    const out = extractNumericSeries(frame, { maxGapFraction: 0.5, maxSingleGapSamples: 10 });
    expect(out).toBeNull();
  });
});

describe('uniform downsampling (maxSamples option)', () => {
  it('leaves short series untouched (downsampledFrom stays 0)', () => {
    const times = Array.from({ length: 100 }, (_, i) => i * 1000);
    const values = times.map((_, i) => i);
    const frame = makeFrame([
      { name: 'time', type: FieldType.time, values: times },
      { name: 'value', type: FieldType.number, values },
    ]);
    const out = extractNumericSeries(frame, { maxSamples: 1000 });
    expect(out).not.toBeNull();
    expect(out!.values.length).toBe(100);
    expect(out!.downsampledFrom).toBe(0);
  });

  it('uniformly downsamples long series to maxSamples and records original length', () => {
    // 500 samples at 1 Hz, downsample to 50
    const times = Array.from({ length: 500 }, (_, i) => i * 1000);
    const values = times.map((_, i) => i); // monotonic 0..499
    const frame = makeFrame([
      { name: 'time', type: FieldType.time, values: times },
      { name: 'value', type: FieldType.number, values },
    ]);
    const out = extractNumericSeries(frame, { maxSamples: 50 });
    expect(out).not.toBeNull();
    expect(out!.values.length).toBe(50);
    expect(out!.downsampledFrom).toBe(500);
    // first + last preserved
    expect(out!.values[0]).toBe(0);
    expect(out!.values[49]).toBe(499);
    // evenly spaced samples
    expect(out!.values[1]).toBe(Math.round(499 / 49));
  });

  it('rescales samplingRate so the time span stays consistent with downsample', () => {
    // 1000 samples at 10 Hz (period 100ms). Downsample to 100.
    const times = Array.from({ length: 1000 }, (_, i) => i * 100);
    const values = times.map((_, i) => i);
    const frame = makeFrame([
      { name: 'time', type: FieldType.time, values: times },
      { name: 'value', type: FieldType.number, values },
    ]);
    const out = extractNumericSeries(frame, { maxSamples: 100 });
    expect(out).not.toBeNull();
    // original sampling rate = 10 Hz; new effective rate = 10 * (100/1000) = 1 Hz
    expect(out!.samplingRate).toBeCloseTo(1, 3);
  });
});

describe('hashSignal', () => {
  it('is deterministic for identical input', () => {
    expect(hashSignal([1, 2, 3, 4, 5])).toBe(hashSignal([1, 2, 3, 4, 5]));
  });

  it('distinguishes different inputs', () => {
    expect(hashSignal([1, 2, 3])).not.toBe(hashSignal([1, 2, 4]));
  });

  it('returns an 8-char hex string', () => {
    expect(hashSignal([0])).toMatch(/^[0-9a-f]{8}$/);
  });
});
