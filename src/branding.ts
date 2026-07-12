import type { PluginBranding } from './core/branding';

/**
 * AlphaInfo Signal Monitor for Security Operations — same engine as the
 * suite's flagship, framed for SecOps / OT teams. Pain: alert fatigue is
 * the top concern for security teams monitoring operational technology
 * (Omdia, Nov 2025). The panel watches security-operations TELEMETRY
 * (event volumes, auth failure rates, network/OT metrics) and marks
 * regime transitions as operational deviations — defensive monitoring,
 * deliberately described in neutral telemetry terms.
 */
export const BRANDING: PluginBranding = {
  productName: 'AlphaInfo Signal Monitor',
  eventNoun: 'operational deviation',
  ctaSubtitle:
    'Classify security-operations telemetry as stable / transition / unstable — reduce alert noise by watching signal structure, not fixed thresholds.',
  defaultDomain: 'security',
  testIdPrefix: 'alphainfo-secops',
};
