import type { GrafanaTheme2 } from '@grafana/data';
import type { ConfidenceBand } from './types';

/**
 * Overlay fill color (with alpha) for a confidence band. Uses the Grafana
 * theme's semantic tokens so dark and light modes both read naturally.
 */
export function bandOverlayColor(theme: GrafanaTheme2, band: ConfidenceBand): string {
  switch (band) {
    case 'stable':
      return withAlpha(theme.colors.success.main, 0.2);
    case 'transition':
      return withAlpha(theme.colors.warning.main, 0.25);
    case 'unstable':
      return withAlpha(theme.colors.error.main, 0.3);
  }
}

export function bandBorderColor(theme: GrafanaTheme2, band: ConfidenceBand): string {
  switch (band) {
    case 'stable':
      return theme.colors.success.main;
    case 'transition':
      return theme.colors.warning.main;
    case 'unstable':
      return theme.colors.error.main;
  }
}

/** Convert #rgb / #rrggbb / rgb(...) / rgba(...) into an rgba() string. */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('rgba(')) {
    return color.replace(/rgba\(([^)]+)\)/, (_, inner: string) => {
      const [r, g, b] = inner.split(',').map((s) => s.trim());
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    });
  }
  if (color.startsWith('rgb(')) {
    return color.replace(/rgb\(([^)]+)\)/, `rgba($1, ${alpha})`);
  }
  const hex = color.startsWith('#') ? color.slice(1) : color;
  const full = hex.length === 3
    ? hex.split('').map((c) => c + c).join('')
    : hex;
  if (full.length !== 6) {
    return color; // unknown format; let the browser decide
  }
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
