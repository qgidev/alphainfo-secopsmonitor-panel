# Changelog

## 1.0.1 — 2026-09-14

- Dependency overrides for the high/critical advisories flagged by npm audit
  (websocket-driver, brace-expansion, browserslist, fast-uri, js-yaml, nanoid,
  postcss, immutable, js-cookie, protobufjs): 0 high / 0 critical after this change.
- Multiscale analysis is now ON by default (`useMultiscale: true`), matching the
  alphainfo API 2.4.0, SDK and playground defaults. Turn it off in Analysis →
  Multiscale for fast mode. Existing dashboards keep their saved value.
- Fingerprint radar: the D1–D5 axis labels on the diagram now carry the same
  explanatory tooltips as the value table (hover any axis).
- Short-window messages now show concrete numbers: how many samples the query
  returned, the engine minimum, and a suggested time-range widening factor.
- First release built and signed through the CI pipeline (provenance
  attestation).

## 1.0.0

Initial release.

- Structural regime classification (stable / transition / unstable) for any
  numeric time series from any Grafana data source, via the alphainfo API.
- Verdict badge with structural score and semantic alert level.
- Regime overlay on the chart.
- Deep mode: per-window timeline showing WHERE the change happened
  (2–10 windows, one batch call per run).
- Quota-aware by design: run-on-demand default, explicit per-run cost in
  the UI, live quota footer from `X-RateLimit-*` headers, upgrade link when
  the allowance runs low, dedicated plan-limit state on HTTP 429.
- Robust series extraction: NaN/gap handling, linear interpolation of small
  gaps, uniform downsampling to the plan's sample cap.
