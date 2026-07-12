import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { AnalyzeResponse, RecommendedAction } from '../types';
import { interpretFingerprint, type FingerprintInterpretation } from '../fingerprintInterpretation';
import { toFingerprintMetrics } from '../fingerprint';

/**
 * The operator-facing reading of the analysis: the semantic layer's
 * summary / severity / recommended action, plus the fingerprint
 * interpretation ("what changed" + "next step") when a dominant
 * structural dimension can be attributed. The radar shows the shape;
 * this panel says it in words.
 */
interface Props {
  response: AnalyzeResponse;
  testIdPrefix: string;
}

const ACTION_LABEL: Record<RecommendedAction, string> = {
  log_only: 'Log only',
  monitor: 'Monitor',
  human_review: 'Review recommended',
  immediate_human_review: 'Immediate review',
};

export const InsightPanel: React.FC<Props> = ({ response, testIdPrefix }) => {
  const styles = useStyles2(getStyles);
  const semantic = response.semantic;
  const fingerprint = toFingerprintMetrics(response.metrics);
  // "What changed" only makes sense when something changed — on a stable
  // verdict the attribution text ("a sharp transition is present…")
  // contradicts the headline and confuses operators.
  const interpretation: FingerprintInterpretation | null =
    fingerprint && response.confidence_band !== 'stable'
      ? interpretFingerprint(fingerprint, response.confidence_band)
      : null;

  if (!semantic && !interpretation) {
    return null;
  }

  return (
    <div className={styles.wrapper} data-testid={`${testIdPrefix}-insight`}>
      {semantic && (
        <>
          <span className={styles.caption}>Reading</span>
          <p className={styles.summary}>{semantic.summary}</p>
          <div className={styles.factRow}>
            {typeof semantic.severity_score === 'number' && (
              <span>
                severity{' '}
                <strong data-testid={`${testIdPrefix}-severity`}>
                  {Math.round(semantic.severity_score)}/100
                </strong>
              </span>
            )}
            <span>
              change score <strong>{response.change_score.toFixed(2)}</strong>
            </span>
            {semantic.recommended_action && (
              <span className={styles.action} data-testid={`${testIdPrefix}-action`}>
                {ACTION_LABEL[semantic.recommended_action]}
              </span>
            )}
          </div>
        </>
      )}
      {interpretation && (
        <div
          className={styles.interpretation}
          data-testid={`${testIdPrefix}-what-changed`}
          data-dominant={interpretation.dominantKey ?? ''}
        >
          <span className={styles.caption}>What changed</span>
          <p className={styles.summary}>{interpretation.whatChanged}</p>
          <p className={styles.next}>{interpretation.suggestedAction}</p>
        </div>
      )}
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  caption: css({
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    fontSize: theme.typography.pxToRem(10),
  }),
  summary: css({
    margin: 0,
    color: theme.colors.text.primary,
    lineHeight: 1.4,
  }),
  next: css({
    margin: 0,
    color: theme.colors.text.secondary,
    lineHeight: 1.4,
  }),
  factRow: css({
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: theme.spacing(1.5),
    rowGap: theme.spacing(0.25),
    color: theme.colors.text.secondary,
    fontVariantNumeric: 'tabular-nums',
  }),
  action: css({
    padding: `0 ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    border: `1px solid ${theme.colors.border.medium}`,
    color: theme.colors.text.primary,
    fontSize: theme.typography.pxToRem(10),
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    alignSelf: 'center',
  }),
  interpretation: css({
    marginTop: theme.spacing(1),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
});
