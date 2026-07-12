import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

interface Props {
  values: number[];
  /**
   * Fallback width (in pixels) used until the ResizeObserver reports the
   * real container size. Also the width used in non-browser test envs
   * where ResizeObserver is unavailable.
   */
  width: number;
  height: number;
  ariaLabel?: string;
}

const PADDING = { top: 8, right: 8, bottom: 8, left: 8 };

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  }),
  svg: css({
    display: 'block',
  }),
  line: css({
    fill: 'none',
    stroke: theme.colors.primary.main,
    strokeWidth: 2,
    strokeLinejoin: 'round',
    strokeLinecap: 'round',
  }),
  axis: css({
    stroke: theme.colors.border.weak,
    strokeWidth: 1,
  }),
  gridline: css({
    stroke: theme.colors.border.weak,
    strokeWidth: 1,
    strokeDasharray: '2 4',
    opacity: 0.6,
  }),
});

/**
 * Lightweight line chart for a single numeric series. Hand-rolled SVG so the
 * plugin has no chart-library dependency. Auto-scales the y-axis to the
 * min/max of the provided values; the x-axis is evenly spaced by index.
 *
 * Sizing: the `width` prop is a fallback. At runtime we measure the
 * actual container width via ResizeObserver so the chart always
 * matches the parent, regardless of what sidebar layout is next to
 * us. This prevents SVG overflow when the surrounding layout grows
 * (e.g., when baseline comparison bars widen the sidebar).
 */
export const TimeSeriesChart: React.FC<Props> = ({ values, width, height, ariaLabel }) => {
  const styles = useStyles2(getStyles);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number>(width);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) { return; }
      const w = Math.round(entry.contentRect.width);
      if (w > 0) {
        setMeasured(w);
      }
    });
    obs.observe(el);
    // Prime with the current measurement so we don't render a frame at
    // the stale prop width.
    const initial = el.getBoundingClientRect().width;
    if (initial > 0) {
      setMeasured(Math.round(initial));
    }
    return () => obs.disconnect();
  }, []);

  const effectiveWidth = measured > 0 ? measured : width;

  const path = useMemo(() => {
    if (values.length < 2 || effectiveWidth <= 0 || height <= 0) {
      return '';
    }
    const plotWidth = Math.max(0, effectiveWidth - PADDING.left - PADDING.right);
    const plotHeight = Math.max(0, height - PADDING.top - PADDING.bottom);
    let min = values[0];
    let max = values[0];
    for (const v of values) {
      if (v < min) { min = v; }
      if (v > max) { max = v; }
    }
    const range = max - min;
    const xStep = plotWidth / (values.length - 1);
    const commands: string[] = [];
    for (let i = 0; i < values.length; i++) {
      const x = PADDING.left + i * xStep;
      // Flip Y so higher values are higher on screen.
      // When the signal is perfectly constant (range === 0) we draw it
      // centered in the plot area — pinning to top or bottom would be
      // a misleading visual.
      const norm = range === 0 ? 0.5 : (values[i] - min) / range;
      const y = PADDING.top + plotHeight * (1 - norm);
      commands.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    return commands.join(' ');
  }, [values, effectiveWidth, height]);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <svg
        className={styles.svg}
        width={effectiveWidth}
        height={height}
        viewBox={`0 0 ${effectiveWidth} ${height}`}
        role="img"
        aria-label={ariaLabel ?? 'Time series signal'}
        data-testid="alphainfo-timeseries"
      >
        <line
          className={styles.gridline}
          x1={PADDING.left}
          y1={PADDING.top + (height - PADDING.top - PADDING.bottom) / 2}
          x2={effectiveWidth - PADDING.right}
          y2={PADDING.top + (height - PADDING.top - PADDING.bottom) / 2}
        />
        <line
          className={styles.axis}
          x1={PADDING.left}
          y1={height - PADDING.bottom}
          x2={effectiveWidth - PADDING.right}
          y2={height - PADDING.bottom}
        />
        <path className={styles.line} d={path} />
      </svg>
    </div>
  );
};
