import {
  AlphaInfoAuthError,
  AlphaInfoRateLimitError,
  AlphaInfoServerError,
  AlphaInfoValidationError,
  analyze,
} from './client';

const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

beforeAll(() => {
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

beforeEach(() => {
  fetchMock.mockReset();
});

function makeResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const status = init.status ?? 200;
  const headerMap = init.headers ?? {};
  const headers = {
    get: (name: string): string | null => headerMap[name.toLowerCase()] ?? null,
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers as unknown as Headers,
    json: async () => body,
  } as unknown as Response;
}

const BASE_REQUEST = { signal: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], sampling_rate: 100 };
const BASE_OPTS = { apiKey: 'ai_test' };

describe('analyze', () => {
  it('POSTs to /v1/analyze/stream with the API key and parses the response', async () => {
    const body = {
      structural_score: 0.85,
      change_detected: false,
      change_score: 0.1,
      confidence_band: 'stable',
      engine_version: '2.2.0',
      analysis_id: 'abc-123',
      metrics: { sim_local: 0.9 },
      semantic: null,
      warning: null,
    };
    fetchMock.mockResolvedValueOnce(makeResponse(body));

    const outcome = await analyze(BASE_REQUEST, BASE_OPTS);

    expect(outcome.response.structural_score).toBe(0.85);
    expect(outcome.response.confidence_band).toBe('stable');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.alphainfo.io/v1/analyze/stream');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ 'X-API-Key': 'ai_test' });
  });

  it('surfaces X-RateLimit-* headers as a typed RateLimitInfo', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({}, {
      headers: {
        'x-ratelimit-limit': '1000',
        'x-ratelimit-remaining': '847',
        'x-ratelimit-reset': '1713580800',
      },
    }));
    const outcome = await analyze(BASE_REQUEST, BASE_OPTS);
    expect(outcome.rateLimit).not.toBeNull();
    expect(outcome.rateLimit!.limit).toBe(1000);
    expect(outcome.rateLimit!.remaining).toBe(847);
    expect(outcome.rateLimit!.resetEpoch).toBe(1713580800);
    // fetchedAt stamped near now
    expect(Math.abs(Date.now() - outcome.rateLimit!.fetchedAt)).toBeLessThan(5000);
  });

  it('returns rateLimit=null when headers are absent', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({}));
    const outcome = await analyze(BASE_REQUEST, BASE_OPTS);
    expect(outcome.rateLimit).toBeNull();
  });

  it('honors a custom baseUrl and trims trailing slashes', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({}));
    await analyze(BASE_REQUEST, { ...BASE_OPTS, baseUrl: 'https://example.test/' }).catch(() => undefined);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/v1/analyze/stream');
  });

  it('rejects with AlphaInfoAuthError when the key is empty', async () => {
    await expect(analyze(BASE_REQUEST, { apiKey: '' })).rejects.toBeInstanceOf(AlphaInfoAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps 401 to AlphaInfoAuthError', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ detail: 'Invalid key' }, { status: 401 }));
    await expect(analyze(BASE_REQUEST, BASE_OPTS)).rejects.toBeInstanceOf(AlphaInfoAuthError);
  });

  it('maps 422 to AlphaInfoValidationError', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ detail: 'Signal too short' }, { status: 422 }));
    await expect(analyze(BASE_REQUEST, BASE_OPTS)).rejects.toBeInstanceOf(AlphaInfoValidationError);
  });

  it('maps 429 to AlphaInfoRateLimitError with Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(
        { detail: { message: 'Quota exceeded' } },
        { status: 429, headers: { 'retry-after': '42' } },
      ),
    );
    try {
      await analyze(BASE_REQUEST, BASE_OPTS);
      throw new Error('expected analyze to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AlphaInfoRateLimitError);
      expect((err as AlphaInfoRateLimitError).retryAfter).toBe(42);
      expect((err as AlphaInfoRateLimitError).message).toBe('Quota exceeded');
    }
  });

  it('falls back to 60s when Retry-After is missing or invalid', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ detail: 'boom' }, { status: 429 }));
    try {
      await analyze(BASE_REQUEST, BASE_OPTS);
      throw new Error('expected analyze to throw');
    } catch (err) {
      expect((err as AlphaInfoRateLimitError).retryAfter).toBe(60);
    }
  });

  it('maps 5xx to AlphaInfoServerError with status preserved', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ detail: 'bad gateway' }, { status: 502 }));
    try {
      await analyze(BASE_REQUEST, BASE_OPTS);
      throw new Error('expected analyze to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AlphaInfoServerError);
      expect((err as AlphaInfoServerError).status).toBe(502);
    }
  });
});
