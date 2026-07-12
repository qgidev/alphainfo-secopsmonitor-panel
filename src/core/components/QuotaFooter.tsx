import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Tooltip, useStyles2 } from '@grafana/ui';
import type { RateLimitInfo } from '../client';
import type { ExtractedSeries } from '../dataTransform';

/**
 * Suite footer: freshness, engine, series facts, and the quota indicator
 * parsed from the X-RateLimit-* headers. This footer is also the suite's
 * upgrade surface — when remaining quota drops under 20% it appends a
 * plain link to the alphainfo billing page. A link, not a paywall: the
 * plugin never blocks, the API's own 429 is the hard stop.
 */
interface Props {
  analyzedAt: number;
  fromCache: boolean;
  engineVersion: string;
  extracted: ExtractedSeries;
  rateLimit: RateLimitInfo | null;
  baseUrl: string;
  /** Extra analyses consumed by the deep-mode batch run, when it ran. */
  deepConsumed: number | null;
  /** What the verdict was measured against (window start vs internal). */
  referenceUsed: 'window-start' | 'internal';
  testIdPrefix: string;
}

/** Over 5 minutes since last analysis counts as stale. */
const STALE_THRESHOLD_MS = 5 * 60 * 1_000;

/** X-RateLimit-Limit at or under this reads as the Free plan. */
const FREE_PLAN_LIMIT = 50;

export const QuotaFooter: React.FC<Props> = ({
  analyzedAt,
  fromCache,
  engineVersion,
  extracted,
  rateLimit,
  baseUrl,
  deepConsumed,
  referenceUsed,
  testIdPrefix,
}) => {
  const styles = useStyles2(getStyles);
  const now = useNow();
  const relative = formatAgo(Math.max(0, now - analyzedAt));
  const stale = now - analyzedAt > STALE_THRESHOLD_MS;

  return (
    <div className={styles.footer}>
      <span
        className={`${styles.inline} ${stale ? styles.stale : ''}`}
        data-testid={`${testIdPrefix}-footer`}
      >
        <span className={stale ? styles.stalePulse : styles.pulse} aria-hidden="true" />
        <span>Analyzed {relative}</span>
        {stale && (
          <Tooltip content="This analysis is older than the 30s in-memory cache TTL. Click the dashboard's Refresh button (or Analyze now) to re-run against current data.">
            <span className={styles.staleChip} data-testid={`${testIdPrefix}-stale-chip`}>stale</span>
          </Tooltip>
        )}
        {fromCache && <span>cached</span>}
        <span>engine {engineVersion}</span>
        <Tooltip
          content={
            referenceUsed === 'window-start'
              ? 'Verdict measured against the first fraction of the visible window.'
              : 'Verdict measured against the engine’s internal reference — dynamic-but-healthy signals (trends, periodicity) often read as transition/unstable here. Windows too short to split fall back to this mode.'
          }
        >
          <span data-testid={`${testIdPrefix}-reference`}>
            {referenceUsed === 'window-start' ? 'vs window start' : 'internal ref'}
          </span>
        </Tooltip>
        <span>{extracted.fieldName}</span>
        {extracted.interpolatedCount > 0 && <span>{extracted.interpolatedCount} interpolated</span>}
        {extracted.downsampledFrom > 0 && (
          <span>
            downsampled {extracted.downsampledFrom.toLocaleString()} →{' '}
            {extracted.values.length.toLocaleString()}
          </span>
        )}
        {deepConsumed !== null && deepConsumed > 0 && (
          <Tooltip content={`Deep mode analyzed ${deepConsumed} windows in one batch call — ${deepConsumed} analyses on top of the headline one.`}>
            <span data-testid={`${testIdPrefix}-deep-consumed`}>deep +{deepConsumed}</span>
          </Tooltip>
        )}
        {rateLimit && (
          <QuotaIndicator rateLimit={rateLimit} baseUrl={baseUrl} testIdPrefix={testIdPrefix} />
        )}
      </span>
    </div>
  );
};

const QuotaIndicator: React.FC<{
  rateLimit: RateLimitInfo;
  baseUrl: string;
  testIdPrefix: string;
}> = ({ rateLimit, baseUrl, testIdPrefix }) => {
  const styles = useStyles2(getStyles);
  const now = useNow();
  const checkedAgo = formatAgo(Math.max(0, now - rateLimit.fetchedAt));
  const { remaining, limit } = rateLimit;
  const pct = limit > 0 ? remaining / limit : 1;
  const cls = pct <= 0.05 ? styles.critical : pct <= 0.2 ? styles.low : styles.quota;
  const ageMs = now - rateLimit.fetchedAt;
  const showCheckedAgo = ageMs > 60_000;
  const billingUrl = `${baseUrl.replace(/\/$/, '')}/dashboard/billing`;
  const showUpgrade = pct <= 0.2;
  const freePlan = limit > 0 && limit <= FREE_PLAN_LIMIT;

  return (
    <span className={styles.quota} data-testid={`${testIdPrefix}-quota`}>
      <Tooltip
        content={`Values parsed from X-RateLimit-* headers on the last analyze call. Checked ${checkedAgo}. Reset epoch: ${rateLimit.resetEpoch ?? 'unknown'}.${freePlan ? ' Free plan detected — run-on-demand mode keeps the 50 analyses/month usable.' : ''}`}
      >
        <span className={cls}>
          Quota {remaining.toLocaleString()} / {limit.toLocaleString()}
          {showCheckedAgo && <> · checked {checkedAgo}</>}
        </span>
      </Tooltip>
      {showUpgrade && (
        <a
          className={styles.upgrade}
          href={billingUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`${testIdPrefix}-upgrade-link`}
        >
          Upgrade →
        </a>
      )}
    </span>
  );
};

function formatAgo(ms: number): string {
  if (ms < 1_000) { return 'just now'; }
  if (ms < 60_000) { return `${Math.floor(ms / 1_000)}s ago`; }
  if (ms < 3_600_000) { return `${Math.floor(ms / 60_000)}m ago`; }
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

/** Ticking clock — re-renders every second so "N seconds ago" labels and
 *  staleness stay live between Grafana refreshes. Keeping the Date.now()
 *  reads inside state satisfies the react-hooks purity rule. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const getStyles = (theme: GrafanaTheme2) => ({
  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    flexWrap: 'wrap',
    rowGap: theme.spacing(0.25),
  }),
  inline: css({
    display: 'inline-flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: theme.spacing(0.25),
    columnGap: theme.spacing(1.5),
    minWidth: 0,
  }),
  quota: css({
    fontVariantNumeric: 'tabular-nums',
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: theme.spacing(0.75),
  }),
  low: css({ color: theme.colors.warning.text, fontWeight: theme.typography.fontWeightMedium }),
  critical: css({ color: theme.colors.error.text, fontWeight: theme.typography.fontWeightMedium }),
  upgrade: css({
    color: theme.colors.primary.text,
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
    '&:hover': { textDecoration: 'underline' },
  }),
  stale: css({
    color: theme.colors.warning.text,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  staleChip: css({
    display: 'inline-flex',
    alignItems: 'center',
    padding: `0 ${theme.spacing(0.75)}`,
    borderRadius: theme.shape.radius.pill,
    border: `1px solid ${theme.colors.warning.border}`,
    background: theme.colors.warning.transparent,
    color: theme.colors.warning.text,
    fontSize: theme.typography.pxToRem(10),
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    fontWeight: theme.typography.fontWeightMedium,
    cursor: 'help',
  }),
  pulse: css({
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: theme.colors.success.main,
    marginRight: theme.spacing(0.5),
    verticalAlign: 'middle',
    boxShadow: `0 0 0 0 ${theme.colors.success.transparent}`,
    animation: 'alphainfo-pulse 1.6s ease-out infinite',
    '@keyframes alphainfo-pulse': {
      '0%': { boxShadow: `0 0 0 0 ${theme.colors.success.transparent}` },
      '70%': { boxShadow: '0 0 0 6px rgba(0,0,0,0)' },
      '100%': { boxShadow: '0 0 0 0 rgba(0,0,0,0)' },
    },
  }),
  stalePulse: css({
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: theme.colors.warning.main,
    marginRight: theme.spacing(0.5),
    verticalAlign: 'middle',
  }),
});
