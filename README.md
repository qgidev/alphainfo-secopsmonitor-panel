# AlphaInfo Signal Monitor for Security Operations — Grafana Panel Plugin

**Triage structural change in your operations telemetry, not threshold noise.**

Alert fatigue is the top concern for security teams monitoring operational
technology (Omdia, Nov 2025): fixed thresholds on event volumes, auth
failure rates, or network counters either page constantly or miss the
change that mattered. This panel takes the telemetry series already on
your dashboard, sends it to the [alphainfo](https://alphainfo.io)
structural analysis API, and classifies its **structure**: did the shape
of this signal's behavior change?

This is a **defensive monitoring** tool. It observes metrics and
classifies signal state — nothing more. It works on any numeric
operations telemetry:

- security event volume per interval,
- authentication failure rates,
- network flow counters, firewall log rates,
- OT / SCADA process metrics and sensor channels.

What you get:

- **Verdict badge** — `STABLE` / `TRANSITION` / `UNSTABLE` with the
  structural score and semantic alert level.
- **Regime overlay** — colored frame naming the current band; transitions
  read as *operational deviations* to prioritize, not as verdicts.
- **Deep mode (optional)** — splits the window into 2–10 segments and
  shows **where** the deviation happened.
- **Quota footer** — live `remaining / limit`, per-run cost always visible.

## Quick start

1. Add an **AlphaInfo Signal Monitor for Security Operations** panel.
2. Get a free API key at
   [alphainfo.io/register](https://alphainfo.io/register) — 50 analyses per
   month, no credit card.
3. Paste it under **Panel options → Authentication**.
4. Click **Analyze now**.

The default domain calibration is `Security` (access patterns, event-rate
telemetry). By default the panel analyzes only when clicked — one analysis
per click. For continuous monitoring, enable **Quota → Re-analyze on
dashboard refresh** and size the plan:

| Usage pattern | Analyses/month | Suggested plan |
| --- | --- | --- |
| On-demand triage clicks | tens | Free ($0) |
| 1 panel, hourly refresh | ~720 | Starter ($49) |
| 1 panel, 5-min refresh | ~8,600 | Growth ($199) |
| 5 panels, 5-min refresh | ~43,000 | Professional ($499) |

Compliance note: paid tiers add response retention with audit trail and
replay (Growth 60d, Professional 90d, Enterprise 365d + on-prem option).

## How it reads

By default the verdict answers: **did the recent telemetry change
structurally vs how the visible window started?** The first half of the
window rides along as the reference (same 1-analysis cost). Scores above
0.70 = **stable**, below 0.35 = **unstable** (structurally different), in
between = **transition**. Give each side 400+ samples for confident
classification. A deviation means the telemetry's structure changed — the
panel surfaces the evidence and severity; interpretation and response stay
with your team and your runbooks.

## Options that matter

| Option | Default | Why |
| --- | --- | --- |
| Domain | Security | Calibrated for event-rate / access-pattern telemetry; switch to Sensors for OT process metrics. |
| Run on demand only | **on** | Analysis costs quota; you decide when to spend it. |
| Re-analyze on refresh | **off** | Turning it on is the moment to size your plan (table above). |
| Deep mode | off | +1 analysis per window per run; localizes the deviation. |
| Max samples sent to API | 9,500 | Free-tier-safe; raise to your plan's cap. |

## What leaves your Grafana (data & privacy)

Relevant for security reviews: each analysis sends exactly this to the
alphainfo API, over HTTPS, authenticated by your `X-API-Key` header:

- the **numeric sample values** of the analyzed telemetry series (and, in
  the default window-start mode, the reference portion of the same series),
- the **sampling rate** (a number derived from the time spacing),
- the chosen **domain** and boolean analysis flags.

It does **not** send metric names, label sets, queries, dashboard metadata,
absolute timestamps, hostnames, IPs, or anything else identifying — the
field name shown in the footer never leaves your browser. Analysis results
are retained per your plan for audit replay (Free 7 days · Starter 30 ·
Growth 60 · Professional 90 · Enterprise 365 + on-prem option). See
[alphainfo.io/privacy](https://alphainfo.io/privacy) and
[alphainfo.io/terms](https://alphainfo.io/terms).

## Production considerations

**API key storage.** Grafana panel plugins store options in the dashboard
JSON — including the API key. Anyone with dashboard *Viewer* access can
read it. Fine for internal SOC dashboards where viewers share the key; for
multi-tenant deployments wait for the companion datasource plugin
(roadmap), which keeps the key encrypted server-side.

**CORS.** The panel calls the alphainfo API from the browser. The managed
API allows any Grafana origin; self-hosted API deployments must whitelist
the Grafana origin and expose the `X-RateLimit-*` headers.

**Alerting.** Grafana alert rules fire off data-source queries, not panel
internals — this panel is an operator-facing triage aid. To alert on
structural scores, run the analysis upstream and write the score back as a
series; a datasource plugin is on the roadmap.

## Troubleshooting

- **"Network error: Failed to fetch"** — CORS preflight failed; whitelist
  the Grafana origin on self-hosted API deployments.
- **"Signal has N samples, but your plan allows up to M"** — lower *Max
  samples sent to API* to your plan's cap.
- **"Plan limit reached"** — monthly allowance or rate cap exhausted; the
  panel shows the `Retry-After` hint and the upgrade path.
- **Unsigned plugin on self-hosted Grafana** —
  `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=alphainfo-secopsmonitor-panel`

## Development

```bash
npm install
npm run dev      # webpack watch into ./dist
npm run server   # docker compose: Grafana + this plugin at :3001
npm run test:ci  # jest
npm run build    # production build
```

Part of the AlphaInfo panel suite (Regime Detection · Signal Monitor for
Security Operations · Drift Monitor). The three plugins share the same
`src/core/` module, synced verbatim from the Regime Detection package —
fix once, fix everywhere (`scripts/sync-core.sh`).

## References

- [alphainfo API guide](https://alphainfo.io/v1/guide)
- [Pricing](https://alphainfo.io/pricing)
- [`plugin.json` reference](https://grafana.com/developers/plugin-tools/reference/plugin-json)
