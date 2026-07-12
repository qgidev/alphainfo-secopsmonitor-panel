import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuditLink } from './AuditLink';
import * as client from '../client';

jest.mock('../client', () => {
  const actual = jest.requireActual('../client');
  return {
    ...actual,
    auditReplay: jest.fn(),
  };
});

const auditReplay = client.auditReplay as jest.MockedFunction<typeof client.auditReplay>;

describe('AuditLink', () => {
  beforeEach(() => {
    auditReplay.mockReset();
  });

  it('renders a button that triggers an authenticated audit fetch', async () => {
    auditReplay.mockResolvedValueOnce({
      analysis_id: 'abc-123-def',
      engine_version: '2.2.0',
      parameters: { domain_applied: 'generic' },
    });

    render(
      <AuditLink
        analysisId="abc-123-def"
        baseUrl="https://example.test"
        apiKey="ai_test"
      />,
    );

    const trigger = screen.getByTestId('alphainfo-audit-link');
    expect(trigger).toBeInTheDocument();
    // It must be a button, not a plain anchor — the old anchor implementation
    // could not send the X-API-Key header required by the backend.
    expect(trigger.tagName).toBe('BUTTON');

    fireEvent.click(trigger);

    await waitFor(() => expect(auditReplay).toHaveBeenCalledTimes(1));
    expect(auditReplay).toHaveBeenCalledWith('abc-123-def', expect.objectContaining({
      apiKey: 'ai_test',
      baseUrl: 'https://example.test',
      // New in 1.1.1: pass an abortSignal so closing the modal
      // mid-request cancels the in-flight fetch instead of just
      // ignoring the response.
      abortSignal: expect.any(AbortSignal),
    }));

    // Payload is rendered inside the modal.
    const body = await screen.findByTestId('alphainfo-audit-body');
    expect(body.textContent).toContain('"engine_version": "2.2.0"');
  });

  it('shows a humanised error when the audit call fails', async () => {
    auditReplay.mockRejectedValueOnce(new client.AlphaInfoAuthError());

    render(
      <AuditLink
        analysisId="abc-123-def"
        baseUrl="https://example.test"
        apiKey=""
      />,
    );

    fireEvent.click(screen.getByTestId('alphainfo-audit-link'));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/API key/);
    });
    expect(screen.queryByTestId('alphainfo-audit-body')).toBeNull();
  });

  it('still exposes the copy-id button for pasting into support tickets', () => {
    auditReplay.mockResolvedValue({});
    render(
      <AuditLink
        analysisId="id with spaces"
        baseUrl="https://example.test"
        apiKey="ai_test"
      />,
    );
    expect(screen.getByTestId('alphainfo-copy-id')).toBeInTheDocument();
  });
});
