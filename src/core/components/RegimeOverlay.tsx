import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { ConfidenceBand } from '../types';
import { bandBorderColor, withAlpha } from '../colorMapping';

interface Props {
  band: ConfidenceBand;
}

const BAND_LABEL: Record<ConfidenceBand, string> = {
  stable: 'Stable',
  transition: 'Transition',
  unstable: 'Unstable',
};

/**
 * Regime overlay — a thin colored frame around the chart plus a subtle tint.
 * Designed so the signal underneath stays easily readable. A status strip at
 * the top names the current band so the overlay is meaningful even for users
 * who are colorblind or glancing at a small panel.
 */
export const RegimeOverlay: React.FC<Props> = ({ band }) => {
  const styles = useStyles2((theme) => stylesForBand(theme, band));
  return (
    <div
      className={styles.overlay}
      /* Not aria-hidden — the stripe text is the authoritative label
         for colorblind users and screen readers. `role="status"` so
         the band announces on change without interrupting the user. */
      role="status"
      aria-label={`Confidence band: ${BAND_LABEL[band]}`}
      data-testid={`alphainfo-overlay-${band}`}
    >
      <div className={styles.stripe}>{BAND_LABEL[band]}</div>
    </div>
  );
};

function stylesForBand(theme: GrafanaTheme2, band: ConfidenceBand) {
  const accent = bandBorderColor(theme, band);
  return {
    overlay: css({
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      // subtle tint so the signal stays the protagonist; frame lines tell the
      // full story even at 0.06 opacity
      background: withAlpha(accent, 0.06),
      borderTop: `3px solid ${accent}`,
      borderBottom: `1px solid ${accent}`,
      boxSizing: 'border-box',
    }),
    stripe: css({
      position: 'absolute',
      top: 0,
      right: 0,
      padding: `${theme.spacing(0.1)} ${theme.spacing(0.75)}`,
      background: accent,
      color: theme.colors.getContrastText(accent),
      fontSize: theme.typography.pxToRem(10),
      fontWeight: theme.typography.fontWeightMedium,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      borderBottomLeftRadius: theme.shape.radius.default,
    }),
  };
}
