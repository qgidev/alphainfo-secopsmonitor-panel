import type { BatchItemResult } from './types';
import {
  assembleDeepTimeline,
  clampWindowCount,
  MAX_DEEP_WINDOWS,
  MIN_DEEP_WINDOWS,
  sliceWindows,
} from './windowing';

describe('clampWindowCount', () => {
  it('clamps into [MIN, MAX] and floors fractions', () => {
    expect(clampWindowCount(0)).toBe(MIN_DEEP_WINDOWS);
    expect(clampWindowCount(2)).toBe(2);
    expect(clampWindowCount(7.9)).toBe(7);
    expect(clampWindowCount(99)).toBe(MAX_DEEP_WINDOWS);
    expect(clampWindowCount(NaN)).toBe(MIN_DEEP_WINDOWS);
  });
});

describe('sliceWindows', () => {
  const series = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('produces the requested number of non-overlapping windows covering the series', () => {
    const windows = sliceWindows(series(400), 8);
    expect(windows).not.toBeNull();
    expect(windows!).toHaveLength(8);
    expect(windows![0].startIdx).toBe(0);
    expect(windows![7].endIdx).toBe(400);
    for (let i = 1; i < windows!.length; i++) {
      expect(windows![i].startIdx).toBe(windows![i - 1].endIdx);
    }
  });

  it('last window absorbs the division remainder', () => {
    const windows = sliceWindows(series(103), 4); // 103/4 = 25 resto 3
    expect(windows!).toHaveLength(4);
    expect(windows![3].values).toHaveLength(28);
    expect(windows!.reduce((acc, w) => acc + w.values.length, 0)).toBe(103);
  });

  it('reduces window count when the series cannot feed every window the engine minimum', () => {
    // 45 samples: 8 janelas de 10 não cabem; 4 de 11 cabem.
    const windows = sliceWindows(series(45), 8);
    expect(windows!).toHaveLength(4);
    expect(Math.min(...windows!.map((w) => w.values.length))).toBeGreaterThanOrEqual(10);
  });

  it('returns null below 2 windows of the engine minimum', () => {
    expect(sliceWindows(series(19), 8)).toBeNull();
  });
});

describe('assembleDeepTimeline', () => {
  const windows = sliceWindows(
    Array.from({ length: 100 }, (_, i) => i),
    4,
  )!;

  const item = (index: number, score: number | null, error: string | null = null): BatchItemResult => ({
    index,
    structural_score: score,
    change_detected: score !== null ? score < 0.35 : null,
    change_score: score !== null ? 1 - score : null,
    confidence_band: score === null ? null : score > 0.7 ? 'stable' : score < 0.35 ? 'unstable' : 'transition',
    engine_version: '2.2.0',
    analysis_id: `id-${index}`,
    metrics: null,
    semantic: null,
    error,
  });

  it('joins results by index and picks the lowest score as worst', () => {
    const t = assembleDeepTimeline(
      windows,
      [item(0, 0.9), item(1, 0.8), item(2, 0.2), item(3, 0.75)],
      4,
    );
    expect(t.windows).toHaveLength(4);
    expect(t.worst?.startIdx).toBe(windows[2].startIdx);
    expect(t.worst?.band).toBe('unstable');
    expect(t.failedCount).toBe(0);
    expect(t.analysesConsumed).toBe(4);
  });

  it('marks failed windows without dropping them and excludes them from worst', () => {
    const t = assembleDeepTimeline(
      windows,
      [item(0, 0.9), item(1, null, 'engine error'), item(2, 0.5), item(3, 0.6)],
      4,
    );
    expect(t.windows[1].error).toBe('engine error');
    expect(t.windows[1].band).toBeNull();
    expect(t.failedCount).toBe(1);
    expect(t.worst?.startIdx).toBe(windows[2].startIdx);
  });

  it('handles out-of-order and missing results defensively', () => {
    const t = assembleDeepTimeline(windows, [item(2, 0.4), item(0, 0.9)], 2);
    expect(t.windows[0].score).toBe(0.9);
    expect(t.windows[2].score).toBe(0.4);
    expect(t.windows[1].error).toBe('missing result');
    expect(t.windows[3].error).toBe('missing result');
    expect(t.failedCount).toBe(2);
    expect(t.worst?.startIdx).toBe(windows[2].startIdx);
  });

  it('joins positionally when the wire omits index (production format)', () => {
    // O formato real de produção (verificado 2026-07-11): sem campo index,
    // resultados em ordem de submissão.
    const wireItems = [0.9, 0.8, 0.2, 0.75].map((score) => {
      const { index: _index, ...rest } = item(0, score);
      return rest;
    });
    const t = assembleDeepTimeline(windows, wireItems, 4);
    expect(t.failedCount).toBe(0);
    expect(t.windows.map((w) => w.score)).toEqual([0.9, 0.8, 0.2, 0.75]);
    expect(t.worst?.startIdx).toBe(windows[2].startIdx);
  });

  it('worst is null when every window failed', () => {
    const t = assembleDeepTimeline(windows, [], 0);
    expect(t.worst).toBeNull();
    expect(t.failedCount).toBe(4);
  });
});
