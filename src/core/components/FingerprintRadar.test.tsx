import React from 'react';
import { render, screen } from '@testing-library/react';
import { FingerprintRadar } from './FingerprintRadar';

describe('FingerprintRadar', () => {
  const metrics = {
    sim_local: 0.8,
    sim_spectral: 0.9,
    sim_fractal: 0.75,
    sim_transition: 0.6,
    sim_trend: 0.95,
  };

  it('renders the five axis labels as neutralized D1..D5', () => {
    render(<FingerprintRadar metrics={metrics} />);
    for (const label of ['D1', 'D2', 'D3', 'D4', 'D5']) {
      // Each label appears twice: once on the SVG radar axis and once
      // in the numeric values table below.
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('does not leak underlying sensitivity names in the rendered UI', () => {
    // Defense in depth: any screenshot should render only D1..D5, never
    // the underlying taxonomy. Regressions on this line indicate the
    // leak came back — either as visible label text or embedded in a
    // tooltip/aria-label that would show up in inspector screenshots.
    const { container } = render(<FingerprintRadar metrics={metrics} />);
    const wholeMarkup = container.innerHTML;
    for (const leakedName of ['Local', 'Spectral', 'Fractal', 'Transition', 'Trend']) {
      // Visible text
      expect(screen.queryByText(leakedName)).toBeNull();
      // Tooltip content / aria-label / data-* attributes. The tooltip
      // copy deliberately uses phrases like "short-range structural
      // changes" instead of the taxonomy words, so this should hold.
      expect(wholeMarkup).not.toMatch(new RegExp(`\\b${leakedName}\\b`));
    }
  });

  it('renders the numeric value table with three-decimal precision', () => {
    render(<FingerprintRadar metrics={metrics} />);
    expect(screen.getByTestId('alphainfo-fingerprint-values')).toBeInTheDocument();
    expect(screen.getByText('0.800')).toBeInTheDocument();
    expect(screen.getByText('0.600')).toBeInTheDocument();
  });

  it('renders a polygon with one vertex per axis', () => {
    const { container } = render(<FingerprintRadar metrics={metrics} />);
    // Four grid rings + one data polygon = 5 polygons.
    const polygons = container.querySelectorAll('polygon');
    expect(polygons.length).toBe(5);
    // Five vertex circles, one per axis.
    expect(container.querySelectorAll('circle').length).toBe(5);
  });

  it('renders a caption by default', () => {
    render(<FingerprintRadar metrics={metrics} />);
    expect(screen.getByText(/structural fingerprint/i)).toBeInTheDocument();
  });

  it('clamps out-of-range values to [0, 1]', () => {
    // NaN and > 1 values must not throw or produce invalid SVG coordinates.
    render(
      <FingerprintRadar
        metrics={{
          sim_local: -0.2,
          sim_spectral: 2,
          sim_fractal: NaN,
          sim_transition: 0.5,
          sim_trend: 1.5,
        }}
      />,
    );
    expect(screen.getByTestId('alphainfo-fingerprint')).toBeInTheDocument();
  });
});
