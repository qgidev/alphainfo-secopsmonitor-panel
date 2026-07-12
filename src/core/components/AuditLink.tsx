import React, { useCallback, useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, IconButton, Modal, Spinner, useStyles2 } from '@grafana/ui';
import {
  AlphaInfoAuthError,
  AlphaInfoNetworkError,
  AlphaInfoRateLimitError,
  AlphaInfoServerError,
  AlphaInfoValidationError,
  AuditReplay,
  auditReplay,
} from '../client';

interface Props {
  analysisId: string;
  baseUrl: string;
  apiKey: string;
}

const getStyles = (theme: GrafanaTheme2) => ({
  row: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    fontSize: theme.typography.bodySmall.fontSize,
    flexWrap: 'wrap',
  }),
  analysisId: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.pxToRem(11),
  }),
  copied: css({
    color: theme.colors.success.text,
    fontSize: theme.typography.pxToRem(11),
  }),
  modalBody: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    minHeight: '160px',
  }),
  modalHeader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  modalId: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.pxToRem(12),
    color: theme.colors.text.primary,
    wordBreak: 'break-all',
  }),
  loader: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(2),
    gap: theme.spacing(1),
    color: theme.colors.text.secondary,
  }),
  error: css({
    color: theme.colors.error.text,
    fontSize: theme.typography.bodySmall.fontSize,
    padding: theme.spacing(1),
    border: `1px solid ${theme.colors.error.border}`,
    background: theme.colors.error.transparent,
    borderRadius: theme.shape.radius.default,
  }),
  pre: css({
    background: theme.colors.background.canvas,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1),
    margin: 0,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.pxToRem(12),
    whiteSpace: 'pre',
    overflow: 'auto',
    maxHeight: '60vh',
  }),
  actions: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
  }),
});

/** Best-effort clipboard write; silent if blocked. */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback for older browsers / non-secure contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function humaniseAuditError(err: unknown): string {
  if (err instanceof AlphaInfoAuthError) {
    return 'API key missing or invalid. Check the panel options and try again.';
  }
  if (err instanceof AlphaInfoRateLimitError) {
    return `Rate limit reached. Retry in ${err.retryAfter}s.`;
  }
  if (err instanceof AlphaInfoValidationError) {
    return err.message || 'The audit server rejected this analysis id.';
  }
  if (err instanceof AlphaInfoServerError) {
    return `Audit server error (HTTP ${err.status}).`;
  }
  if (err instanceof AlphaInfoNetworkError) {
    return 'Network error while loading the audit replay.';
  }
  return err instanceof Error ? err.message : 'Could not load audit replay.';
}

/**
 * Audit-trail row: a button that opens an in-plugin modal with the full
 * `/v1/audit/replay/{id}` payload, plus a small "Copy ID" button for
 * pasting the analysis_id into tickets, compliance logs, or support chat.
 *
 * Why a modal and not a plain `<a>`: the audit replay endpoint requires
 * the `X-API-Key` header and a browser tab opening a link cannot send
 * custom headers — clicking a link returned `{"detail":"Invalid API
 * key"}`. The modal fetches with the same authenticated client the panel
 * uses, so the key never appears in a URL.
 */
export const AuditLink: React.FC<Props> = ({ analysisId, baseUrl, apiKey }) => {
  const styles = useStyles2(getStyles);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const [open, setOpen] = useState(false);
  // Result is keyed by analysis_id: a stale result for a previous
  // analysis simply stops matching and reads as "not fetched yet" —
  // no reset-on-change effect needed (that pattern trips the
  // react-hooks/set-state-in-effect rule and causes cascading renders).
  const [result, setResult] = useState<{
    id: string;
    payload?: AuditReplay;
    error?: string;
  } | null>(null);

  const payload = result?.id === analysisId ? result.payload ?? null : null;
  const error = result?.id === analysisId ? result.error ?? null : null;
  // Derived, not stored: the modal is loading whenever it is open with
  // nothing to show for the current analysis_id.
  const loading = open && !payload && !error;

  const copyId = useCallback(async () => {
    const ok = await writeToClipboard(analysisId);
    if (ok) {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1600);
    }
  }, [analysisId]);

  // When the modal opens, fetch the replay (unless we already have it
  // for this analysis_id — cheap cache so reopening doesn't re-hit the
  // endpoint). An AbortController is passed through so closing the modal
  // mid-request actually cancels the HTTP call, not just the state update.
  useEffect(() => {
    if (!open || payload || error) {
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const body = await auditReplay(analysisId, {
          apiKey,
          baseUrl,
          abortSignal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setResult({ id: analysisId, payload: body });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setResult({ id: analysisId, error: humaniseAuditError(err) });
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [open, payload, error, analysisId, apiKey, baseUrl]);

  const copyBody = useCallback(async () => {
    if (!payload) {
      return;
    }
    const ok = await writeToClipboard(JSON.stringify(payload, null, 2));
    if (ok) {
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 1600);
    }
  }, [payload]);

  const onDismiss = useCallback(() => {
    setOpen(false);
    // Dropping a failed result on close means reopening retries the fetch.
    setResult((r) => (r && r.id === analysisId && r.error ? null : r));
  }, [analysisId]);

  return (
    <div className={styles.row}>
      <Button
        variant="secondary"
        fill="text"
        size="sm"
        icon="document-info"
        onClick={() => setOpen(true)}
        data-testid="alphainfo-audit-link"
        aria-label={`View audit replay for analysis ${analysisId}`}
      >
        Audit replay
      </Button>
      <span className={styles.analysisId}>· {analysisId.slice(0, 8)}</span>
      <IconButton
        name={copiedId ? 'check' : 'copy'}
        size="sm"
        tooltip={copiedId ? 'Copied!' : 'Copy full analysis_id'}
        aria-label="Copy analysis id"
        onClick={copyId}
        data-testid="alphainfo-copy-id"
      />
      {copiedId && <span className={styles.copied}>copied</span>}

      {open && (
        <Modal
          title="Audit replay"
          isOpen={open}
          onDismiss={onDismiss}
          data-testid="alphainfo-audit-modal"
        >
          <div className={styles.modalBody}>
            <div className={styles.modalHeader}>
              <span>analysis_id</span>
              <span className={styles.modalId}>{analysisId}</span>
            </div>

            {loading && (
              <div className={styles.loader}>
                <Spinner />
                <span>Loading audit payload…</span>
              </div>
            )}

            {!loading && error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}

            {!loading && !error && payload && (
              <pre className={styles.pre} data-testid="alphainfo-audit-body">
                {JSON.stringify(payload, null, 2)}
              </pre>
            )}

            <div className={styles.actions}>
              {payload && !loading && !error && (
                <Button
                  variant="secondary"
                  icon={copiedBody ? 'check' : 'copy'}
                  onClick={copyBody}
                  data-testid="alphainfo-audit-copy-body"
                >
                  {copiedBody ? 'Copied' : 'Copy JSON'}
                </Button>
              )}
              <Button variant="primary" onClick={onDismiss}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
