# Changelog

## 1.0.1 (Unreleased)

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
