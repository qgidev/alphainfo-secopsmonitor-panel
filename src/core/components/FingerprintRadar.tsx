import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Tooltip, useStyles2 } from '@grafana/ui';
import type { FingerprintMetrics } from '../types';

interface Props {
  metrics: FingerprintMetrics;
  size?: number;
  caption?: string;
}

interface AxisLabel {
  key: keyof FingerprintMetrics;
  label: string;
  tooltip: string;
}

// Axis labels are D1..D5 in the UI — neutralized to prevent a
// screenshot alone from revealing the 5 underlying sensitivities.
// Tooltip text uses the official SDK 1.5.10 `FingerprintResult`
// docstring language (sensitivity to X-range structural changes),
// which is already use-language with no methodology detail. Field
// names `sim_*` remain the SDK/API contract and appear in the audit
// replay modal for technical users who need them.
const AXES: AxisLabel[] = [
  { key: 'sim_local',      label: 'D1', tooltip: 'Sensitivity to short-range structural changes. Range [0, 1]; higher = more preserved.' },
  { key: 'sim_spectral',   label: 'D2', tooltip: 'Sensitivity to medium-scale structural changes. Range [0, 1]; higher = more preserved.' },
  { key: 'sim_fractal',    label: 'D3', tooltip: 'Sensitivity to cross-scale structural changes. Range [0, 1]; higher = more preserved.' },
  { key: 'sim_transition', label: 'D4', tooltip: 'Sensitivity to sharp structural transitions. Range [0, 1]; higher = more preserved.' },
  { key: 'sim_trend',      label: 'D5', tooltip: 'Sensitivity to long-range structural changes. Range [0, 1]; higher = more preserved.' },
];

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    fontFamily: theme.typography.fontFamily,
  }),
  caption: css({
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    fontSize: theme.typography.pxToRem(10),
  }),
  grid: css({
    stroke: theme.colors.border.weak,
    fill: 'none',
    strokeWidth: 1,
  }),
  axis: css({
    stroke: theme.colors.border.weak,
    strokeWidth: 1,
  }),
  polygon: css({
    fill: theme.colors.primary.transparent,
    stroke: theme.colors.primary.main,
    strokeWidth: 2,
    strokeLinejoin: 'round',
  }),
  axisLabel: css({
    fill: theme.colors.text.secondary,
    fontSize: theme.typography.pxToRem(11),
    textAnchor: 'middle',
    dominantBaseline: 'middle',
  }),
  vertex: css({
    fill: theme.colors.primary.main,
  }),
  values: css({
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    rowGap: theme.spacing(0.25),
    columnGap: theme.spacing(1),
    width: '100%',
    maxWidth: 200,
    alignSelf: 'center',
    fontSize: theme.typography.pxToRem(11),
    fontVariantNumeric: 'tabular-nums',
  }),
  valueName: css({
    color: theme.colors.text.secondary,
  }),
  valueNumber: css({
    color: theme.colors.text.primary,
    textAlign: 'right',
    fontWeight: theme.typography.fontWeightMedium,
  }),
});

/**
 * Radar diagram of the 5-dimensional structural fingerprint with a
 * key-value table of the exact scores underneath. Values are clamped
 * to [0, 1]. Axis labels are neutralized (D1..D5) in the UI so that a
 * screenshot does not expose the sensitivity taxonomy; hover tooltips
 * and the key-value row describe each axis in use-language. The
 * underlying field names (`sim_*`) are still the public SDK/API
 * contract and appear in the audit replay payload.
 */
export const FingerprintRadar: React.FC<Props> = ({
  metrics,
  size = 180,
  caption = 'Structural fingerprint',
}) => {
  const styles = useStyles2(getStyles);

  const viewBox = 200;
  const center = viewBox / 2;
  const radius = viewBox * 0.38;

  const geometry = useMemo(() => {
    return AXES.map(({ key, label }, i) => {
      const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / AXES.length;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const raw = metrics[key];
      const value = clamp01(typeof raw === 'number' ? raw : 0);
      return {
        key,
        label,
        cos,
        sin,
        raw,
        value,
        outerX: center + cos * radius,
        outerY: center + sin * radius,
        labelX: center + cos * (radius * 1.22),
        labelY: center + sin * (radius * 1.22),
        pointX: center + cos * radius * value,
        pointY: center + sin * radius * value,
      };
    });
  }, [metrics, center, radius]);

  const gridRings = [0.25, 0.5, 0.75, 1].map((r) => ({
    r,
    points: geometry.map((g) => `${center + g.cos * radius * r},${center + g.sin * radius * r}`).join(' '),
  }));
  const polygonPoints = geometry.map((g) => `${g.pointX},${g.pointY}`).join(' ');

  return (
    <div className={styles.wrapper} data-testid="alphainfo-fingerprint">
      <span className={styles.caption}>{caption}</span>
      <svg viewBox={`0 0 ${viewBox} ${viewBox}`} width={size} height={size} role="img" aria-label={caption}>
        {gridRings.map(({ r, points }) => (
          <polygon key={r} className={styles.grid} points={points} />
        ))}
        {geometry.map((g) => (
          <line
            key={g.key}
            className={styles.axis}
            x1={center}
            y1={center}
            x2={g.outerX}
            y2={g.outerY}
          />
        ))}
        <polygon className={styles.polygon} points={polygonPoints} />
        {geometry.map((g) => (
          <circle key={`v-${g.key}`} className={styles.vertex} cx={g.pointX} cy={g.pointY} r={3} />
        ))}
        {geometry.map((g) => (
          <text key={`l-${g.key}`} className={styles.axisLabel} x={g.labelX} y={g.labelY}>
            {g.label}
          </text>
        ))}
      </svg>
      <div className={styles.values} data-testid="alphainfo-fingerprint-values">
        {AXES.map(({ key, label, tooltip }) => {
          const raw = metrics[key];
          const display = typeof raw === 'number' && Number.isFinite(raw) ? raw.toFixed(3) : '—';
          return (
            <React.Fragment key={key}>
              <Tooltip content={tooltip}>
                <span className={styles.valueName}>{label}</span>
              </Tooltip>
              <span className={styles.valueNumber}>{display}</span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) { return 0; }
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
