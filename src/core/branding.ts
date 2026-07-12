import type { AlphaInfoDomain } from './types';
import type { CoreAnalysisOptions } from './analysisOptions';

/**
 * Everything that differs between the plugins in the AlphaInfo suite.
 * The panel factory (`createPanel`) and options builder
 * (`buildPanelOptions`) consume this so the three SKUs share one code
 * path with different words and defaults — never forked logic.
 */
export interface PluginBranding {
  /** Product name as shown inside the panel UI (not plugin.json). */
  productName: string;
  /**
   * What a detected change is called for this audience, lowercase
   * singular: "regime change" (SRE), "operational deviation" (SecOps),
   * "drift event" (MLOps).
   */
  eventNoun: string;
  /** Short line under the on-demand CTA, audience-appropriate. */
  ctaSubtitle: string;
  /** Default analysis domain for this audience. */
  defaultDomain: AlphaInfoDomain | 'auto';
  /** data-testid prefix; keep stable per plugin for e2e. */
  testIdPrefix: string;
  /** Extra defaults layered over CORE_DEFAULT_OPTIONS. */
  optionOverrides?: Partial<CoreAnalysisOptions>;
}
