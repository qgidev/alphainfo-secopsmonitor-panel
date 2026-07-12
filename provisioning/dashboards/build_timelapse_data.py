#!/usr/bin/env python3
"""Pre-compute the time-lapse demo data:

  1. Generate a synthetic P99 latency series spanning 24 h.
  2. Walk a sliding analysis window across the day (one alphainfo
     call per simulated hour). At each step, record what alphainfo
     would have said at that point in time.
  3. Walk a parallel "naïve threshold" detector (latency > 200 ms for
     N consecutive minutes) and record when it would have fired.
  4. Dump everything as a single JSON file the standalone HTML demo
     loads with `fetch()`.

The output is fully deterministic — same seed → same data → same
detection moments. Re-run whenever you want fresh timestamps.

Why pre-compute on the server: alphainfo costs quota, and we want a
demo that plays smoothly at 24 frames per second. Calling the API
24 times during build is fine; calling it 1440 times during playback
would be wasteful and slow.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request


# ── Synthetic P99 latency ─────────────────────────────────────────


def synth_p99(
    minutes: int = 1440,
    base_ms: float = 120.0,
    # Drift starts earlier (hour 10) and is steeper (0.25 ms/min =
    # 15 ms / h). With the 6-hour sliding alphainfo window, the
    # window centered on hour 12 already contains 2 h of drift, so
    # the engine has structural evidence to leave "stable". By hour
    # 14 the window is dominated by drift and should clearly read
    # transition / unstable.
    drift_starts_at: float = 10 / 24,
    drift_per_min_ms: float = 0.25,
    # Small step at hour 18 — by then the drift alone has pushed
    # latency near 200 ms; the +30 ms step is what reliably trips
    # the "5 minutes above 200 ms" threshold rule. Without it the
    # threshold timing depends too sensitively on noise.
    step_at: float = 18 / 24,
    step_ms: float = 30.0,
    # Lower diurnal amplitude and lower noise so the trend is the
    # dominant structural feature. With higher noise, alphainfo
    # picks up spurious "transitions" from ordinary diurnal cycles
    # — confusing for a demo. Real production signals have richer
    # structure that compensates, but for the demo we keep the
    # SNR generous on purpose.
    diurnal_amp_ms: float = 15.0,
    diurnal_period_min: float = 1440.0,
    noise_ms: float = 6.0,
    seed: int = 17,
) -> list[float]:
    """24 h of P99 latency (one sample / minute) with a slow drift
    starting at hour 10 and a small step regression at hour 18.

    The drift is alphainfo's-only signal: it shifts the structural
    fingerprint long before any single sample crosses a flat
    threshold. The small step at hour 18 is what reliably trips the
    naïve threshold rule. The interval between the two is the head
    start the demo proves is real.
    """
    r = random.Random(seed)
    drift_start = int(minutes * drift_starts_at)
    step_start = int(minutes * step_at)
    out: list[float] = []
    for i in range(minutes):
        diurnal = diurnal_amp_ms * math.sin(2 * math.pi * i / diurnal_period_min)
        drift = max(0, i - drift_start) * drift_per_min_ms
        step = step_ms if i >= step_start else 0.0
        noise = r.gauss(0, noise_ms)
        out.append(max(0.0, base_ms + diurnal + drift + step + noise))
    return out


# ── Naïve threshold detector (the "without alphainfo" baseline) ───


def threshold_detector(
    series: list[float],
    threshold_ms: float = 200.0,
    consecutive_minutes: int = 5,
) -> list[bool]:
    """Classic alerting rule: fire when latency stays above
    `threshold_ms` for `consecutive_minutes` straight, like a
    Prometheus `for: 5m` clause. Returns a list of bools the same
    length as `series` — `True` from the moment the rule first fires
    and from every later sample (the alert is "active")."""
    fired = False
    consecutive = 0
    out = []
    for v in series:
        if v >= threshold_ms:
            consecutive += 1
            if consecutive >= consecutive_minutes:
                fired = True
        else:
            consecutive = 0
        out.append(fired)
    return out


# ── alphainfo sliding-window calls ────────────────────────────────


def call_alphainfo_analyze(
    *,
    signal: list[float],
    sampling_rate_hz: float,
    api_key: str,
    base_url: str,
    domain: str = "generic",
    baseline: list[float] | None = None,
) -> dict:
    """One synchronous POST to /v1/analyze/stream. Returns the parsed
    response on 2xx. Raises a clear RuntimeError on auth / quota /
    network failures so the caller can decide to retry or abort.

    When `baseline` is provided, alphainfo compares the current window
    against that fixed reference instead of judging the window's own
    internal self-similarity. For the time-lapse demo this is what
    makes the engine catch a slow drift: a window full of pure ramp
    is internally consistent (slope is the same), but its fingerprint
    differs from a healthy baseline.
    """
    payload: dict = {
        "signal": signal,
        "sampling_rate": sampling_rate_hz,
        "domain": domain,
        "use_multiscale": True,
        "include_semantic": True,
    }
    if baseline is not None:
        payload["baseline"] = baseline
    body = json.dumps(payload).encode()
    req = request.Request(
        url=f"{base_url.rstrip('/')}/v1/analyze/stream",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
            "User-Agent": "alphainfo-timelapse-demo/0.1",
        },
    )
    try:
        with request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200]
        raise RuntimeError(f"alphainfo {e.code}: {body}") from e
    except error.URLError as e:
        raise RuntimeError(f"alphainfo network error: {e}") from e


def sliding_alphainfo(
    series: list[float],
    *,
    api_key: str,
    base_url: str,
    window_minutes: int = 360,        # 6 h of context per call
    step_minutes: int = 10,           # one call every 10 simulated minutes
    sampling_rate_hz: float = 1 / 60, # 1 sample per minute
) -> list[dict]:
    """Walk the series with a sliding window, calling alphainfo at
    each step. Returns a list of {at_minute, structural_score,
    confidence_band, ...} entries the player will use to decide when
    each frame's "alphainfo state" should change.

    Decisions:
      - The first window has to be at least `window_minutes` long, so
        we don't issue calls until that much data has accumulated.
        Real-world bridge runs have the same constraint.
      - We step every 10 simulated minutes — fine enough that the
        playback shows alphainfo's confidence_band evolving smoothly
        as the structural fingerprint shifts, coarse enough to keep
        quota use reasonable (≈108 calls per 24 h window).
      - We pass the LAST `window_minutes` samples to alphainfo; this
        is exactly what the bridge does in production.
    """
    # Lock the first full window as the "healthy reference" baseline.
    # Every subsequent call compares against this fixed signal, so the
    # structural similarity reflects "how different is now vs. the
    # known-healthy first window" — not "how internally consistent is
    # this current window in isolation". This is the same pattern the
    # plugin uses in production with `useBaselineComparison: true`.
    baseline = list(series[:window_minutes])
    samples: list[dict] = []
    n = len(series)
    for end_min in range(window_minutes, n + 1, step_minutes):
        signal = series[end_min - window_minutes:end_min]
        try:
            resp = call_alphainfo_analyze(
                signal=signal,
                baseline=baseline,
                sampling_rate_hz=sampling_rate_hz,
                api_key=api_key,
                base_url=base_url,
            )
        except RuntimeError as exc:
            print(f"  [warn] tick at minute={end_min}: {exc}", file=sys.stderr)
            continue
        metrics = resp.get("metrics") or {}
        sample = {
            "at_minute": end_min,
            "structural_score": resp.get("structural_score"),
            "change_score": resp.get("change_score"),
            "confidence_band": resp.get("confidence_band"),
            "fingerprint_available": metrics.get("fingerprint_available"),
            "sim_local": metrics.get("sim_local"),
            "sim_spectral": metrics.get("sim_spectral"),
            "sim_fractal": metrics.get("sim_fractal"),
            "sim_transition": metrics.get("sim_transition"),
            "sim_trend": metrics.get("sim_trend"),
            "severity_score": (resp.get("semantic") or {}).get("severity_score"),
            "alert_level": (resp.get("semantic") or {}).get("alert_level"),
        }
        samples.append(sample)
        score = sample["structural_score"]
        band = sample["confidence_band"]
        score_str = f"{score:.3f}" if isinstance(score, (int, float)) else "—"
        print(f"  tick @ {end_min:>4}min: band={band:<10} score={score_str}")
        # Pace the calls so we don't burst quota; the API is fine
        # with this throughput, this is just polite.
        time.sleep(0.2)
    return samples


# ── Detection moment derivation ───────────────────────────────────


def first_alphainfo_alert(samples: list[dict]) -> int | None:
    """The minute at which alphainfo's confidence_band first leaves
    `stable`. Returns None if it never does (a clean run that we
    don't want for this demo)."""
    for s in samples:
        if s["confidence_band"] in ("transition", "unstable"):
            return s["at_minute"]
    return None


def first_threshold_alert(threshold_state: list[bool]) -> int | None:
    """The minute at which the naïve detector first fires."""
    for i, fired in enumerate(threshold_state):
        if fired:
            return i
    return None


# ── Output ────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--out",
        default=str(Path(__file__).parent / "timelapse_data.json"),
        help="Output JSON file path",
    )
    p.add_argument(
        "--api-key",
        default=os.environ.get("ALPHAINFO_API_KEY"),
        help="alphainfo API key (defaults to $ALPHAINFO_API_KEY)",
    )
    p.add_argument(
        "--base-url",
        default="https://www.alphainfo.io",
    )
    p.add_argument("--seed", type=int, default=17)
    p.add_argument(
        "--skip-alphainfo",
        action="store_true",
        help="Skip the alphainfo calls and use a deterministic mock for offline testing",
    )
    args = p.parse_args(argv)

    if not args.skip_alphainfo and not args.api_key:
        print(
            "ERROR: --api-key or $ALPHAINFO_API_KEY required (or pass --skip-alphainfo)",
            file=sys.stderr,
        )
        return 1

    print("[1/3] Generating synthetic P99 latency series (1440 samples / 24 h) ...")
    latency = synth_p99(seed=args.seed)
    print(f"      done · range = {min(latency):.0f} ms .. {max(latency):.0f} ms")

    print("[2/3] Computing naïve threshold detector (200 ms · 5 min) ...")
    threshold_state = threshold_detector(latency, threshold_ms=200.0, consecutive_minutes=5)
    fired_at = first_threshold_alert(threshold_state)
    if fired_at is not None:
        print(f"      threshold first fired at minute {fired_at} (= {fired_at // 60}h{fired_at % 60:02d}m)")
    else:
        print("      threshold never fired (signal stayed below 200 ms)")

    if args.skip_alphainfo:
        print("[3/3] Skipping alphainfo calls — using a deterministic mock series.")
        # Mock: stable until minute 720, then transition climbing.
        alphainfo_samples = []
        for end in range(360, 1441, 10):
            score = max(0.1, 1.0 - max(0, (end - 720)) / 720.0)
            band = "stable" if score > 0.85 else "transition" if score > 0.5 else "unstable"
            alphainfo_samples.append({
                "at_minute": end,
                "structural_score": round(score, 3),
                "change_score": round(1.0 - score, 3),
                "confidence_band": band,
                "fingerprint_available": True,
                "sim_local": round(score * 0.95, 3),
                "sim_spectral": round(score * 0.92, 3),
                "sim_fractal": round(score * 0.88, 3),
                "sim_transition": round(score * 0.80, 3),
                "sim_trend": round(score * 0.75, 3),
                "severity_score": round((1.0 - score) * 100, 1),
                "alert_level": (
                    "normal" if score > 0.85
                    else "attention" if score > 0.65
                    else "alert" if score > 0.4
                    else "critical"
                ),
            })
    else:
        print("[3/3] Calling alphainfo across sliding windows (1 call / hour) ...")
        alphainfo_samples = sliding_alphainfo(
            latency, api_key=args.api_key, base_url=args.base_url
        )
        print(f"      {len(alphainfo_samples)} alphainfo states recorded")

    alphainfo_alert_at = first_alphainfo_alert(alphainfo_samples)
    if alphainfo_alert_at is not None:
        print(
            f"      alphainfo first non-stable at minute {alphainfo_alert_at} "
            f"(= {alphainfo_alert_at // 60}h{alphainfo_alert_at % 60:02d}m)"
        )

    head_start = None
    if alphainfo_alert_at is not None and fired_at is not None:
        head_start = fired_at - alphainfo_alert_at

    payload = {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "minutes": len(latency),
        "latency_ms": [round(v, 3) for v in latency],
        "threshold_state": threshold_state,
        "threshold_first_fired_at_minute": fired_at,
        "alphainfo_samples": alphainfo_samples,
        "alphainfo_first_alert_at_minute": alphainfo_alert_at,
        "head_start_minutes": head_start,
    }
    Path(args.out).write_text(json.dumps(payload, indent=2))
    size_kb = Path(args.out).stat().st_size // 1024
    print(f"\n[done] wrote {args.out} · {size_kb} KiB")
    if head_start is not None:
        print(
            f"[done] alphainfo gave {head_start} minutes "
            f"({head_start // 60}h{head_start % 60:02d}m) of head start"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
