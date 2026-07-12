import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import type { AnalyzeResponse, FingerprintReason } from '../types';
import { extractEngineNote } from '../fingerprint';

/**
 * Human-friendly messages for each `fingerprint_reason` enum value the
 * engine may emit. Shown in the radar slot when the 5D fingerprint is
 * absent — silently hiding the radar would read as a rendering bug.
 *
 * Decision order (most specific wins): engine `_note` free-form context,
 * then the `fingerprint_reason` enum, then heuristics for older engines.
 */
const FP_REASON_MESSAGES: Record<FingerprintReason, string> = {
  signal_too_short:
    'Signal below the fingerprint threshold (engine needs ~200+ samples).',
  structural_degenerate:
    'Signal is structurally preserved (near-constant); decomposition not meaningful.',
  internal_error:
    'The engine could not decompose this signal. Try widening the time range or refreshing.',
};

interface Props {
  response: AnalyzeResponse;
  testIdPrefix: string;
}

export const FingerprintFallback: React.FC<Props> = ({ response, testIdPrefix }) => {
  const styles = useStyles2(getStyles);
  const reason = response.metrics?.fingerprint_reason;
  const engineNote = extractEngineNote(response.metrics);
  let message: string;
  if (engineNote) {
    message = engineNote;
  } else if (reason && reason in FP_REASON_MESSAGES) {
    message = FP_REASON_MESSAGES[reason];
  } else {
    const highlyPreserved =
      response.structural_score >= 0.95 && response.change_score <= 0.05;
    const warning = response.warning ?? '';
    const lowConfidence = /samples?|confidence|neutral|limited/i.test(warning);
    message = highlyPreserved
      ? FP_REASON_MESSAGES.structural_degenerate
      : lowConfidence
        ? FP_REASON_MESSAGES.signal_too_short
        : 'The engine did not return a structural fingerprint for this call.';
  }
  return (
    <div
      className={styles.placeholder}
      data-testid={`${testIdPrefix}-fingerprint-na`}
      data-reason={reason ?? ''}
      data-source={engineNote ? 'engine_note' : reason ? 'reason_enum' : 'heuristic'}
    >
      <span className={styles.caption}>Structural fingerprint</span>
      <span>{message}</span>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  placeholder: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.5),
    padding: theme.spacing(1.5),
    minHeight: 120,
    borderRadius: theme.shape.radius.default,
    border: `1px dashed ${theme.colors.border.weak}`,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    textAlign: 'center',
  }),
  caption: css({
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    fontSize: theme.typography.pxToRem(10),
  }),
});
