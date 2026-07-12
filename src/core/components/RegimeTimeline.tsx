import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Tooltip, useStyles2 } from '@grafana/ui';
import type { DeepTimelineResult, DeepWindowResult } from '../windowing';
import { bandBorderColor, withAlpha } from '../colorMapping';

interface Props {
  timeline: DeepTimelineResult;
  /** Length of the analyzed series; segment widths are proportional. */
  totalLength: number;
  eventNoun: string;
  testIdPrefix: string;
}

/**
 * Deep-mode strip: one colored segment per analyzed window, aligned under
 * the chart, answering "WHERE did it change". The most divergent window
 * gets a marker so the eye lands there first. Failed windows render as a
 * hatched neutral segment rather than disappearing — a silently missing
 * window would read as "nothing happened there".
 */
export const RegimeTimeline: React.FC<Props> = ({
  timeline,
  totalLength,
  eventNoun,
  testIdPrefix,
}) => {
  const styles = useStyles2(getStyles);
  if (totalLength <= 0 || timeline.windows.length === 0) {
    return null;
  }
  return (
    <div
      className={styles.strip}
      role="img"
      aria-label={`Per-window ${eventNoun} timeline, ${timeline.windows.length} windows`}
      data-testid={`${testIdPrefix}-timeline`}
    >
      {timeline.windows.map((w, i) => (
        <Segment
          key={i}
          window={w}
          totalLength={totalLength}
          isWorst={timeline.worst !== null && w === timeline.worst && w.score !== null}
          eventNoun={eventNoun}
          testIdPrefix={testIdPrefix}
        />
      ))}
    </div>
  );
};

const Segment: React.FC<{
  window: DeepWindowResult;
  totalLength: number;
  isWorst: boolean;
  eventNoun: string;
  testIdPrefix: string;
}> = ({ window: w, totalLength, isWorst, eventNoun, testIdPrefix }) => {
  const styles = useStyles2((theme) => segmentStyles(theme, w, isWorst));
  const widthPct = ((w.endIdx - w.startIdx) / totalLength) * 100;
  const label =
    w.score === null
      ? `Samples ${w.startIdx}–${w.endIdx}: window analysis failed (${w.error ?? 'unknown'})`
      : `Samples ${w.startIdx}–${w.endIdx}: ${w.band ?? 'unknown'} · score ${w.score.toFixed(2)}${
          isWorst ? ` · most divergent window — likely ${eventNoun} location` : ''
        }`;
  return (
    <Tooltip content={label}>
      <div
        className={styles.segment}
        style={{ width: `${widthPct}%` }}
        data-testid={`${testIdPrefix}-timeline-segment`}
        data-band={w.band ?? 'failed'}
        data-worst={isWorst ? 'true' : undefined}
        aria-label={label}
      >
        {isWorst && <span className={styles.worstMark} aria-hidden="true">▲</span>}
      </div>
    </Tooltip>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  strip: css({
    display: 'flex',
    width: '100%',
    height: theme.spacing(1.5),
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
    border: `1px solid ${theme.colors.border.weak}`,
  }),
});

function segmentStyles(theme: GrafanaTheme2, w: DeepWindowResult, isWorst: boolean) {
  const base =
    w.band !== null
      ? withAlpha(bandBorderColor(theme, w.band), isWorst ? 0.85 : 0.45)
      : `repeating-linear-gradient(45deg, ${theme.colors.border.weak}, ${theme.colors.border.weak} 3px, transparent 3px, transparent 6px)`;
  return {
    segment: css({
      position: 'relative',
      height: '100%',
      background: base,
      cursor: 'help',
      '&:not(:last-child)': {
        borderRight: `1px solid ${theme.colors.background.primary}`,
      },
    }),
    worstMark: css({
      position: 'absolute',
      top: '-2px',
      left: '50%',
      transform: 'translateX(-50%)',
      fontSize: 8,
      lineHeight: 1,
      color: theme.colors.text.primary,
    }),
  };
}
