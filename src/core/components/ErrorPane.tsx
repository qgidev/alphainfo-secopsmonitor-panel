import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, useStyles2 } from '@grafana/ui';
import { AlphaInfoRateLimitError } from '../client';

interface Props {
  error: Error;
  retryAfter: number | null;
  onRetry: () => void;
  baseUrl: string;
  testIdPrefix: string;
}

/**
 * Error state with a retry button. A 429 gets dedicated copy: on the
 * alphainfo API that status means the monthly plan allowance (or the
 * per-minute rate cap) is exhausted — there is no automatic overage, so
 * the honest next steps are "wait for reset" or "upgrade the plan". The
 * retry button stays enabled either way; the API re-rejects harmlessly
 * with a fresh Retry-After if the user jumps the gun.
 */
export const ErrorPane: React.FC<Props> = ({ error, retryAfter, onRetry, baseUrl, testIdPrefix }) => {
  const styles = useStyles2(getStyles);
  const isQuota = error instanceof AlphaInfoRateLimitError;
  const billingUrl = `${baseUrl.replace(/\/$/, '')}/dashboard/billing`;

  if (isQuota) {
    return (
      <div data-testid={`${testIdPrefix}-error-quota`}>
        <div className={styles.errorText}>Plan limit reached</div>
        <div className={styles.errorDetail}>
          Your alphainfo plan&rsquo;s analysis allowance (or its rate cap) is exhausted.
          Upgrades apply immediately with proportional billing — or wait for the
          window to reset.
        </div>
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="primary"
            onClick={() => window.open(billingUrl, '_blank', 'noopener,noreferrer')}
            data-testid={`${testIdPrefix}-error-upgrade-button`}
          >
            Upgrade plan
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="sync"
            onClick={onRetry}
            data-testid={`${testIdPrefix}-retry-button`}
          >
            Try again
          </Button>
          {typeof retryAfter === 'number' && retryAfter > 0 && (
            <span className={styles.errorDetail}>
              API suggests waiting {retryAfter}s (Retry-After header)
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-testid={`${testIdPrefix}-error`}>
      <div className={styles.errorText}>alphainfo analysis failed</div>
      <div className={styles.errorDetail}>{error.message}</div>
      <div className={styles.actions}>
        <Button
          size="sm"
          variant="secondary"
          icon="sync"
          onClick={onRetry}
          data-testid={`${testIdPrefix}-retry-button`}
        >
          Try again
        </Button>
      </div>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  errorText: css({
    color: theme.colors.error.text,
    maxWidth: 480,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  errorDetail: css({
    color: theme.colors.text.secondary,
    marginTop: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    maxWidth: 480,
  }),
  actions: css({
    marginTop: theme.spacing(1.5),
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  }),
});
