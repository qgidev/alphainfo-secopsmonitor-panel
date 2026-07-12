import { PanelPlugin } from '@grafana/data';
import type { CoreAnalysisOptions } from './core/analysisOptions';
import { buildPanelOptions } from './core/buildOptions';
import { createPanel } from './core/createPanel';
import { BRANDING } from './branding';

export const plugin = new PanelPlugin<CoreAnalysisOptions>(createPanel(BRANDING)).setPanelOptions(
  buildPanelOptions(BRANDING),
);
