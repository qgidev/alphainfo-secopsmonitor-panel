import type { PanelOptionsEditorBuilder } from '@grafana/data';
import { CORE_DEFAULT_OPTIONS, type CoreAnalysisOptions } from './analysisOptions';
import type { PluginBranding } from './branding';
import { MAX_DEEP_WINDOWS, MIN_DEEP_WINDOWS } from './windowing';
import { ApiKeyEditor } from './components/ApiKeyEditor';

const DOMAIN_OPTIONS = [
  { value: 'auto' as const, label: 'Auto (let the engine pick)' },
  { value: 'generic' as const, label: 'Generic' },
  { value: 'finance' as const, label: 'Finance' },
  { value: 'biomedical' as const, label: 'Biomedical' },
  { value: 'sensors' as const, label: 'Sensors' },
  { value: 'security' as const, label: 'Security' },
  { value: 'ai_ml' as const, label: 'AI / ML' },
  { value: 'power_grid' as const, label: 'Power grid' },
  { value: 'seismic' as const, label: 'Seismic' },
  { value: 'traffic' as const, label: 'Traffic' },
];

/** Effective defaults for a plugin = core defaults + branding overrides. */
export function mergeDefaults(branding: PluginBranding): CoreAnalysisOptions {
  return {
    ...CORE_DEFAULT_OPTIONS,
    domain: branding.defaultDomain,
    ...branding.optionOverrides,
  };
}

/**
 * Shared panel-options builder. The quota story is deliberate: the two
 * spend-controlling switches (run on demand, re-analyze on refresh) sit
 * in their own "Quota" category with the per-run cost spelled out, so
 * turning auto-refresh on is always an informed decision.
 */
export function buildPanelOptions(branding: PluginBranding) {
  const defaults = mergeDefaults(branding);
  return (builder: PanelOptionsEditorBuilder<CoreAnalysisOptions>) =>
    builder
      .addCustomEditor({
        id: 'apiKey',
        path: 'apiKey',
        name: 'API key',
        description:
          'Your alphainfo API key (starts with ai_). Hidden by default — click the eye to reveal. Free key (no credit card) at alphainfo.io/dashboard/api-keys.',
        defaultValue: defaults.apiKey,
        category: ['Authentication'],
        settings: { placeholder: 'ai_...' },
        editor: ApiKeyEditor,
      })
      .addTextInput({
        path: 'baseUrl',
        name: 'Base URL',
        description: 'alphainfo API base URL. Change only for self-hosted deployments.',
        defaultValue: defaults.baseUrl,
        category: ['Authentication'],
      })
      .addSelect({
        path: 'domain',
        name: 'Domain',
        description: 'Analysis domain. Affects confidence-band calibration.',
        defaultValue: defaults.domain,
        category: ['Analysis'],
        settings: { options: DOMAIN_OPTIONS },
      })
      .addSelect({
        path: 'referenceMode',
        name: 'Compare against',
        description:
          'Window start (recommended): verdict answers "did the recent part change vs the first fraction of the window?" — healthy dynamic signals read stable. Engine internal: asks whether the signal is self-consistent; trends and periodic signals often read as transition/unstable there. Both cost the same 1 analysis.',
        defaultValue: defaults.referenceMode,
        category: ['Analysis'],
        settings: {
          options: [
            { value: 'window-start' as const, label: 'Window start (recommended)' },
            { value: 'internal' as const, label: 'Engine internal reference' },
          ],
        },
      })
      .addNumberInput({
        path: 'baselineFraction',
        name: 'Reference fraction',
        description:
          'Share of the visible window used as the reference (0.1-0.9). Give each side 400+ samples for confident classification — widen the time range or raise the query resolution if the verdict hovers in "transition".',
        defaultValue: defaults.baselineFraction,
        category: ['Analysis'],
        settings: { min: 0.1, max: 0.9 },
        showIf: (opts) => opts.referenceMode !== 'internal',
      })
      .addNumberInput({
        path: 'samplingRate',
        name: 'Sampling rate (Hz)',
        description: 'Leave at 0 to auto-detect from the time field.',
        defaultValue: defaults.samplingRate,
        category: ['Analysis'],
        settings: { min: 0 },
      })
      .addNumberInput({
        path: 'maxSignalSamples',
        name: 'Max samples sent to API',
        description:
          'Longer series are uniformly downsampled. Tier caps: Free 10k · Starter 100k · Growth 500k · Pro 1M · Enterprise 5M. Default 9500 is Free-safe; raise it to match your plan.',
        defaultValue: defaults.maxSignalSamples,
        category: ['Analysis'],
        settings: { min: 50, integer: true },
      })
      .addBooleanSwitch({
        path: 'useMultiscale',
        name: 'Multiscale analysis',
        description: 'Run analysis across multiple window sizes. More thorough, ~250-500ms vs ~200ms.',
        defaultValue: defaults.useMultiscale,
        category: ['Analysis'],
      })
      .addBooleanSwitch({
        path: 'deepMode',
        name: 'Deep mode (where did it change)',
        description: `Slices the series into windows and analyzes each in one batch call, rendering a per-window timeline. Costs one extra analysis PER WINDOW per run (default ${CORE_DEFAULT_OPTIONS.deepWindowCount}).`,
        defaultValue: defaults.deepMode,
        category: ['Analysis'],
      })
      .addNumberInput({
        path: 'deepWindowCount',
        name: 'Deep mode windows',
        description: `Windows per deep run (${MIN_DEEP_WINDOWS}-${MAX_DEEP_WINDOWS}). ${MAX_DEEP_WINDOWS} is the Free/Starter batch cap, so a deep run always fits one batch call.`,
        defaultValue: defaults.deepWindowCount,
        category: ['Analysis'],
        settings: { min: MIN_DEEP_WINDOWS, max: MAX_DEEP_WINDOWS, integer: true },
        showIf: (opts) => opts.deepMode,
      })
      .addBooleanSwitch({
        path: 'runOnDemand',
        name: 'Run on demand only',
        description:
          'The panel waits for an explicit "Analyze now" click before calling the API. Default ON — the Free plan (50 analyses/month) lasts months this way. Turn OFF for continuous monitoring on paid plans.',
        defaultValue: defaults.runOnDemand,
        category: ['Quota'],
      })
      .addBooleanSwitch({
        path: 'refreshOnQuery',
        name: 'Re-analyze on dashboard refresh',
        description:
          'Each dashboard refresh re-runs the analysis (30 s cache still applies). A 5-minute refresh interval spends ~8,600 analyses/month per panel — Growth tier territory. Leave OFF to analyze only on explicit actions.',
        defaultValue: defaults.refreshOnQuery,
        category: ['Quota'],
      })
      .addBooleanSwitch({
        path: 'showBadge',
        name: 'Verdict badge',
        description: 'Headline badge with band, verdict, and structural score.',
        defaultValue: defaults.showBadge,
        category: ['Display'],
      })
      .addBooleanSwitch({
        path: 'showOverlay',
        name: 'Regime overlay',
        description: 'Colored frame over the chart reflecting the confidence band.',
        defaultValue: defaults.showOverlay,
        category: ['Display'],
      })
      .addBooleanSwitch({
        path: 'showInsight',
        name: 'Reading & what changed',
        description:
          'Sidebar with the engine’s human-readable summary, severity, recommended action, and the dominant structural change with a suggested next step.',
        defaultValue: defaults.showInsight,
        category: ['Display'],
      })
      .addBooleanSwitch({
        path: 'showFingerprint',
        name: 'Structural fingerprint (5D radar)',
        description:
          'Radar of the 5 structural sensitivities (D1..D5) — diagnoses which KIND of change occurred, not just how big.',
        defaultValue: defaults.showFingerprint,
        category: ['Display'],
      })
      .addBooleanSwitch({
        path: 'showAuditLink',
        name: 'Audit replay',
        description:
          'Button that opens the full recorded payload of this analysis (audit endpoint; does not consume quota).',
        defaultValue: defaults.showAuditLink,
        category: ['Display'],
      });
}
