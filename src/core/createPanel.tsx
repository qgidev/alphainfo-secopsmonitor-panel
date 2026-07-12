import React from 'react';
import { css } from '@emotion/css';
import { FieldType, GrafanaTheme2, PanelProps } from '@grafana/data';
import { PanelDataErrorView } from '@grafana/runtime';
import { Button, LoadingPlaceholder, useStyles2 } from '@grafana/ui';
import type { CoreAnalysisOptions } from './analysisOptions';
import type { PluginBranding } from './branding';
import { useAlphaInfoAnalysis, type IdleReason } from './useAnalysis';
import { useDeepTimeline } from './useDeepTimeline';
import { toFingerprintMetrics } from './fingerprint';
import { AuditLink } from './components/AuditLink';
import { ErrorPane } from './components/ErrorPane';
import { FingerprintFallback } from './components/FingerprintFallback';
import { FingerprintRadar } from './components/FingerprintRadar';
import { InsightPanel } from './components/InsightPanel';
import { QuotaFooter } from './components/QuotaFooter';
import { RegimeBadge } from './components/RegimeBadge';
import { RegimeOverlay } from './components/RegimeOverlay';
import { RegimeTimeline } from './components/RegimeTimeline';
import { TimeSeriesChart } from './components/TimeSeriesChart';

/**
 * Panel factory for the AlphaInfo suite. Each plugin instantiates this
 * with its own `PluginBranding`; ALL rendering and API logic lives here
 * so the three SKUs cannot drift apart. Composition, top to bottom:
 * verdict badge → chart with regime overlay → deep-mode timeline →
 * quota footer (the suite's upgrade surface).
 */
export function createPanel(branding: PluginBranding): React.FC<PanelProps<CoreAnalysisOptions>> {
  const Panel: React.FC<PanelProps<CoreAnalysisOptions>> = ({
    options,
    data,
    width,
    height,
    fieldConfig,
    id,
  }) => {
    const styles = useStyles2(getStyles);
    const { state, retry, start } = useAlphaInfoAnalysis({ data, options });

    const successExtracted = state.status === 'success' ? state.extracted : null;
    const samplingRate =
      options.samplingRate > 0
        ? options.samplingRate
        : successExtracted?.samplingRate ?? 1;
    const deep = useDeepTimeline({
      extracted: successExtracted,
      samplingRate,
      options,
    });

    if (data.series.length === 0) {
      return (
        <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} needsNumberField />
      );
    }

    // Sidebar (insight + 5D fingerprint + audit) sits beside the chart on
    // wide panels and flows under it on narrow ones.
    const sidebarOn = options.showInsight || options.showFingerprint || options.showAuditLink;
    const sideBySide = sidebarOn && width >= SIDEBAR_MIN_WIDTH;
    const overhead =
      16 + // root padding
      (options.showBadge ? 36 : 0) +
      (options.deepMode ? 24 : 0) +
      (sidebarOn && !sideBySide ? 170 : 0) + // stacked sidebar steals chart height
      28; // footer
    const chartHeight = Math.max(80, height - overhead);
    const chartWidth = Math.max(100, width - 16 - (sideBySide ? SIDEBAR_WIDTH + 16 : 0));

    if (state.status === 'idle') {
      if (state.reason === 'awaiting-start') {
        const previewFrame = data.series[0];
        const previewField = previewFrame?.fields.find((f) => f.type === FieldType.number);
        const previewValues = (previewField?.values as number[] | undefined) ?? [];
        const analysesPerRun = 1 + (options.deepMode ? options.deepWindowCount : 0);
        return (
          <div className={styles.root}>
            <div className={styles.chartContainer}>
              {previewValues.length > 1 && (
                <TimeSeriesChart
                  values={previewValues}
                  width={chartWidth}
                  height={Math.max(80, height - 16)}
                  ariaLabel="Series preview (analysis pending)"
                />
              )}
              <div
                className={styles.startOverlay}
                data-testid={`${branding.testIdPrefix}-idle-awaiting-start`}
              >
                <div className={styles.startCard}>
                  <span className={styles.startCaption}>{branding.productName}</span>
                  <span className={styles.startTitle}>Ready to analyze</span>
                  <span className={styles.startSubtitle}>
                    {previewValues.length > 0
                      ? `${branding.ctaSubtitle} This run uses ${analysesPerRun} ${
                          analysesPerRun === 1 ? 'analysis' : 'analyses'
                        } of your plan.`
                      : 'No samples in the current time range yet — widen the range first.'}
                  </span>
                  <Button
                    variant="primary"
                    size="lg"
                    icon="play"
                    onClick={start}
                    disabled={previewValues.length < 10}
                    data-testid={`${branding.testIdPrefix}-start-button`}
                  >
                    Analyze now
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      }
      const copy = buildIdleCopy(options.baseUrl)[state.reason];
      return (
        <div className={styles.root}>
          <div
            className={styles.centered}
            data-testid={`${branding.testIdPrefix}-idle-${state.reason}`}
          >
            <div>
              <div>{copy.title}</div>
              <div className={styles.idleDetail}>{copy.detail}</div>
            </div>
          </div>
        </div>
      );
    }

    if (state.status === 'loading') {
      return (
        <div className={styles.root}>
          <div className={styles.chartContainer}>
            <TimeSeriesChart
              values={state.extracted.values}
              width={chartWidth}
              height={chartHeight}
              ariaLabel={`Series ${state.extracted.fieldName}`}
            />
          </div>
          <LoadingPlaceholder text={`Analyzing with ${branding.productName}…`} />
        </div>
      );
    }

    if (state.status === 'error') {
      return (
        <div className={styles.root}>
          <div className={styles.chartContainer}>
            <TimeSeriesChart
              values={state.extracted.values}
              width={chartWidth}
              height={chartHeight}
              ariaLabel={`Series ${state.extracted.fieldName}`}
            />
          </div>
          <ErrorPane
            error={state.error}
            retryAfter={state.retryAfter}
            onRetry={retry}
            baseUrl={options.baseUrl}
            testIdPrefix={branding.testIdPrefix}
          />
        </div>
      );
    }

    // Success
    const { response, extracted } = state;
    const deepRateLimit = deep.status === 'success' ? deep.rateLimit : null;
    const fingerprint = options.showFingerprint ? toFingerprintMetrics(response.metrics) : null;
    const sidebar = sidebarOn ? (
      <div className={sideBySide ? styles.sidebar : styles.sidebarStacked}>
        <div className={styles.sidebarScroll}>
          {options.showInsight && (
            <InsightPanel response={response} testIdPrefix={branding.testIdPrefix} />
          )}
          {options.showFingerprint &&
            (fingerprint ? (
              <FingerprintRadar metrics={fingerprint} />
            ) : (
              <FingerprintFallback response={response} testIdPrefix={branding.testIdPrefix} />
            ))}
        </div>
        {options.showAuditLink && (
          <div className={styles.sidebarFooter}>
            <AuditLink
              analysisId={response.analysis_id}
              baseUrl={options.baseUrl}
              apiKey={options.apiKey}
            />
          </div>
        )}
      </div>
    ) : null;

    return (
      <div className={styles.root} data-testid={`${branding.testIdPrefix}-success`}>
        {options.showBadge && (
          <div className={styles.badgeRow}>
            <RegimeBadge
              response={response}
              eventNoun={branding.eventNoun}
              testIdPrefix={branding.testIdPrefix}
            />
            <Button
              size="sm"
              variant="secondary"
              fill="text"
              icon="sync"
              onClick={retry}
              tooltip="Re-analyze the current data (spends quota)"
              data-testid={`${branding.testIdPrefix}-reanalyze-button`}
            >
              Re-analyze
            </Button>
          </div>
        )}
        <div className={sideBySide ? styles.bodySide : styles.bodyStack}>
          <div className={styles.chartColumn}>
            <div className={styles.chartContainer}>
              <TimeSeriesChart
                values={extracted.values}
                width={chartWidth}
                height={chartHeight}
                ariaLabel={`Series ${extracted.fieldName}`}
              />
              {options.showOverlay && <RegimeOverlay band={response.confidence_band} />}
            </div>
            {options.deepMode && (
              <div className={styles.deepRow}>
                {deep.status === 'success' && (
                  <RegimeTimeline
                    timeline={deep.timeline}
                    totalLength={extracted.values.length}
                    eventNoun={branding.eventNoun}
                    testIdPrefix={branding.testIdPrefix}
                  />
                )}
                {deep.status === 'loading' && (
                  <span className={styles.deepNote}>Deep mode: analyzing windows…</span>
                )}
                {deep.status === 'too-short' && (
                  <span className={styles.deepNote}>
                    Deep mode needs at least 20 samples (2 windows × engine minimum) — widen
                    the time range.
                  </span>
                )}
                {deep.status === 'error' && (
                  <span className={styles.deepNote}>
                    Deep mode failed: {deep.error.message}
                  </span>
                )}
              </div>
            )}
          </div>
          {sidebar}
        </div>
        <QuotaFooter
          analyzedAt={state.analyzedAt}
          fromCache={state.fromCache}
          engineVersion={response.engine_version}
          extracted={extracted}
          rateLimit={deepRateLimit ?? state.rateLimit}
          baseUrl={options.baseUrl}
          deepConsumed={deep.status === 'success' ? deep.timeline.analysesConsumed : null}
          referenceUsed={state.referenceUsed}
          testIdPrefix={branding.testIdPrefix}
        />
      </div>
    );
  };
  Panel.displayName = `${branding.testIdPrefix}-panel`;
  return Panel;
}

interface IdleCopy {
  title: string;
  detail: React.ReactNode;
}

function buildIdleCopy(baseUrl: string): Record<IdleReason, IdleCopy> {
  const keysUrl = `${baseUrl.replace(/\/$/, '')}/dashboard/api-keys`;
  return {
    'no-api-key': {
      title: 'Configure your alphainfo API key',
      detail: (
        <>
          Open <strong>Panel options → Authentication</strong> and paste the key that starts
          with &ldquo;ai_&rdquo;.{' '}
          <a href={keysUrl} target="_blank" rel="noopener noreferrer">
            Get a free key at {keysUrl.replace(/^https?:\/\//, '')} → (no credit card)
          </a>
        </>
      ),
    },
    'invalid-api-key-format': {
      title: 'API key format looks wrong',
      detail: (
        <>
          Real alphainfo keys start with <strong>ai_</strong> and contain only letters,
          numbers, underscores, or hyphens. Check what was pasted, or regenerate it at{' '}
          <a href={keysUrl} target="_blank" rel="noopener noreferrer">
            {keysUrl.replace(/^https?:\/\//, '')}
          </a>
          .
        </>
      ),
    },
    'no-data': {
      title: 'No data in the current time range',
      detail: 'Widen the time range or check the data source query.',
    },
    'no-numeric-field': {
      title: 'No numeric field to analyze',
      detail:
        'The current query returns rows but no numeric field. Pick a query that returns a time series of numbers (e.g., Prometheus rate(), InfluxDB aggregation).',
    },
    'series-too-short': {
      title: 'Series is too short to analyze',
      detail:
        'alphainfo needs at least 10 finite samples. 200+ are recommended for stable classification.',
    },
    'gap-too-large': {
      title: 'Series has too many gaps',
      detail:
        'More than 5% of the nominal series is missing, or a single gap is too wide. Narrow the time range or pick a series with fewer dropouts.',
    },
    'baseline-window-too-short': {
      title: 'Time range too short for baseline comparison',
      detail:
        'The split would leave one half below the engine minimum (10 samples). Widen the time range or turn baseline comparison off.',
    },
    'awaiting-start': {
      title: 'Ready to analyze',
      detail: 'Click "Analyze now" to send the visible series to alphainfo.',
    },
  };
}

/** Panel width at which the sidebar moves beside the chart. */
const SIDEBAR_MIN_WIDTH = 640;
const SIDEBAR_WIDTH = 240;

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    boxSizing: 'border-box',
  }),
  bodySide: css({
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'row',
    gap: theme.spacing(2),
    minHeight: 0,
  }),
  bodyStack: css({
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    minHeight: 0,
  }),
  chartColumn: css({
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    minWidth: 0,
    minHeight: 0,
  }),
  sidebar: css({
    flex: `0 0 ${SIDEBAR_WIDTH}px`,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    paddingRight: theme.spacing(0.5),
  }),
  sidebarStacked: css({
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing(2),
    alignItems: 'flex-start',
    maxHeight: 170,
    overflowY: 'auto',
  }),
  sidebarScroll: css({
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  sidebarFooter: css({
    flex: '0 0 auto',
    paddingTop: theme.spacing(1),
    marginTop: theme.spacing(1),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  badgeRow: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    flexWrap: 'wrap',
  }),
  chartContainer: css({
    position: 'relative',
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: 80,
    background: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  }),
  deepRow: css({
    flex: '0 0 auto',
  }),
  deepNote: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  centered: css({
    flex: '1 1 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    color: theme.colors.text.secondary,
    padding: theme.spacing(2),
  }),
  idleDetail: css({
    color: theme.colors.text.secondary,
    marginTop: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  startOverlay: css({
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background:
      'linear-gradient(to right, rgba(20,22,28,0.55) 0%, rgba(20,22,28,0.7) 50%, rgba(20,22,28,0.55) 100%)',
    backdropFilter: 'blur(2px)',
  }),
  startCard: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(2.5, 3),
    borderRadius: theme.shape.radius.default,
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    boxShadow: theme.shadows.z2,
    maxWidth: 380,
    textAlign: 'center',
  }),
  startCaption: css({
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontSize: theme.typography.pxToRem(10),
    color: theme.colors.primary.text,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  startTitle: css({
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),
  startSubtitle: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    lineHeight: 1.4,
    marginBottom: theme.spacing(0.5),
  }),
});
