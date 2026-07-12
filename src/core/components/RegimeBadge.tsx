import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Tooltip, useStyles2 } from '@grafana/ui';
import type { AnalyzeResponse, ConfidenceBand } from '../types';
import { bandBorderColor, withAlpha } from '../colorMapping';

interface Props {
  response: AnalyzeResponse;
  /** Audience word for a detected change, e.g. "regime change". */
  eventNoun: string;
  testIdPrefix: string;
}

const BAND_LABEL: Record<ConfidenceBand, string> = {
  stable: 'Stable',
  transition: 'Transition',
  unstable: 'Unstable',
};

/**
 * The headline verdict: a colored badge naming the confidence band, the
 * structural score, and — when the semantic layer is on — the alert level.
 * This is the "glanceable" element the suite leads with; the chart and
 * timeline below it are the evidence.
 */
export const RegimeBadge: React.FC<Props> = ({ response, eventNoun, testIdPrefix }) => {
  const styles = useStyles2((theme) => getStyles(theme, response.confidence_band));
  const band = response.confidence_band;
  const alert = response.semantic?.alert_level ?? null;
  const verdict = response.change_detected
    ? `${capitalize(eventNoun)} detected`
    : `No ${eventNoun} detected`;

  return (
    <div
      className={styles.row}
      role="status"
      aria-label={`${verdict}. Band ${BAND_LABEL[band]}, structural score ${response.structural_score.toFixed(2)}.`}
      data-testid={`${testIdPrefix}-badge`}
    >
      <span className={styles.badge} data-testid={`${testIdPrefix}-badge-band`}>
        {BAND_LABEL[band]}
      </span>
      <span className={styles.verdict}>{verdict}</span>
      <Tooltip content="Structural similarity to the engine's internal reference for this series: 1.00 = structure fully preserved, below 0.35 = structurally different.">
        <span className={styles.score} data-testid={`${testIdPrefix}-badge-score`}>
          score {response.structural_score.toFixed(2)}
        </span>
      </Tooltip>
      {alert && alert !== 'normal' && (
        <span className={styles.alert} data-testid={`${testIdPrefix}-badge-alert`}>
          {alert}
        </span>
      )}
    </div>
  );
};

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function getStyles(theme: GrafanaTheme2, band: ConfidenceBand) {
  const accent = bandBorderColor(theme, band);
  return {
    row: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      flexWrap: 'wrap',
      minHeight: theme.spacing(3.5),
    }),
    badge: css({
      padding: `${theme.spacing(0.25)} ${theme.spacing(1.25)}`,
      borderRadius: theme.shape.radius.pill,
      background: accent,
      color: theme.colors.getContrastText(accent),
      fontWeight: theme.typography.fontWeightBold,
      fontSize: theme.typography.pxToRem(12),
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    }),
    verdict: css({
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
    }),
    score: css({
      fontVariantNumeric: 'tabular-nums',
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      cursor: 'help',
    }),
    alert: css({
      padding: `0 ${theme.spacing(0.75)}`,
      borderRadius: theme.shape.radius.pill,
      border: `1px solid ${accent}`,
      background: withAlpha(accent, 0.12),
      color: theme.colors.text.primary,
      fontSize: theme.typography.pxToRem(10),
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }),
  };
}
