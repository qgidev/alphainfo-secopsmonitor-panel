/**
 * Browser-side HTTP client for the alphainfo API.
 *
 * CORS: this runs in the Grafana browser context, so the alphainfo API must
 * send `Access-Control-Allow-Origin` matching Grafana's origin. Grafana Panel
 * plugins cannot proxy through the Grafana backend — the `routes` field and
 * `secureJsonData` are Datasource-only features (see plugin.json reference).
 * The alphainfo FastAPI backend must whitelist the Grafana origin in its
 * CORSMiddleware configuration.
 *
 * Future: a companion Datasource plugin can move this to the Grafana server
 * proxy and remove the API-key-in-dashboard-JSON concern.
 */
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  BatchAnalyzeRequest,
  BatchAnalyzeResponse,
  HealthResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://www.alphainfo.io';
const DEFAULT_TIMEOUT_MS = 60_000;

export class AlphaInfoAuthError extends Error {
  readonly status = 401;
  constructor(message = 'Invalid or missing API key') {
    super(message);
    this.name = 'AlphaInfoAuthError';
  }
}

export class AlphaInfoValidationError extends Error {
  readonly status: 400 | 413 | 422;
  constructor(message: string, status: 400 | 413 | 422 = 400) {
    super(message);
    this.status = status;
    this.name = 'AlphaInfoValidationError';
  }
}

export class AlphaInfoRateLimitError extends Error {
  readonly status = 429;
  constructor(message: string, public readonly retryAfter: number) {
    super(message);
    this.name = 'AlphaInfoRateLimitError';
  }
}

export class AlphaInfoServerError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'AlphaInfoServerError';
  }
}

export class AlphaInfoNetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AlphaInfoNetworkError';
  }
}

export interface AlphaInfoRequestOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Caller-provided abort signal; composed with the internal timeout. */
  abortSignal?: AbortSignal;
}

/** Parsed X-RateLimit-* response headers exposed to the UI. */
export interface RateLimitInfo {
  /** Total allowed in the window. */
  limit: number;
  /** Remaining in the current window. */
  remaining: number;
  /** Unix epoch seconds when the window resets, or null if not provided. */
  resetEpoch: number | null;
  /** Timestamp (ms since epoch) when these numbers were observed. */
  fetchedAt: number;
}

/** Envelope returned by `analyze` so the UI can surface rate-limit state. */
export interface AnalyzeOutcome {
  response: AnalyzeResponse;
  rateLimit: RateLimitInfo | null;
}

function buildUrl(baseUrl: string | undefined, path: string): string {
  const root = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  return `${root}${path}`;
}

function extractDetail(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return '';
  }
  const maybe = body as { detail?: unknown; message?: unknown };
  const d = maybe.detail ?? maybe.message;
  if (typeof d === 'string') {
    return d;
  }
  if (typeof d === 'object' && d !== null && 'message' in d) {
    const inner = (d as { message: unknown }).message;
    return typeof inner === 'string' ? inner : JSON.stringify(d);
  }
  return d === undefined ? '' : JSON.stringify(d);
}

async function readJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function handleErrorResponse(response: Response): Promise<never> {
  const body = await readJsonSafe(response);
  const detail = extractDetail(body);

  if (response.status === 401) {
    throw new AlphaInfoAuthError(detail || undefined);
  }
  if (response.status === 400 || response.status === 413 || response.status === 422) {
    throw new AlphaInfoValidationError(
      detail || `HTTP ${response.status}`,
      response.status,
    );
  }
  if (response.status === 429) {
    const header = response.headers.get('retry-after');
    const parsed = header !== null ? Number(header) : NaN;
    const retryAfter = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
    throw new AlphaInfoRateLimitError(
      detail || 'Rate limit exceeded',
      retryAfter,
    );
  }
  throw new AlphaInfoServerError(
    detail || `HTTP ${response.status}`,
    response.status,
  );
}

async function requestRaw(
  url: string,
  init: RequestInit,
  opts: Pick<AlphaInfoRequestOptions, 'timeoutMs' | 'abortSignal'>,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  opts.abortSignal?.addEventListener('abort', onExternalAbort);

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AlphaInfoNetworkError(
        opts.abortSignal?.aborted
          ? 'Request aborted by caller'
          : `Request timed out after ${timeoutMs}ms`,
        err,
      );
    }
    throw new AlphaInfoNetworkError(
      `Network error: ${(err as Error).message}`,
      err,
    );
  } finally {
    clearTimeout(timeoutId);
    opts.abortSignal?.removeEventListener('abort', onExternalAbort);
  }

  if (!response.ok) {
    await handleErrorResponse(response);
  }
  return response;
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  opts: Pick<AlphaInfoRequestOptions, 'timeoutMs' | 'abortSignal'>,
): Promise<T> {
  const response = await requestRaw(url, init, opts);
  return (await response.json()) as T;
}

/**
 * Parse the X-RateLimit-* headers the alphainfo API exposes on every
 * authenticated request. Returns null if the server did not include
 * these headers (e.g., older deployments or reverse-proxies that strip
 * them from CORS responses).
 */
export function parseRateLimit(headers: Headers, fetchedAt: number = Date.now()): RateLimitInfo | null {
  const limit = parseNonNegativeInt(headers.get('x-ratelimit-limit'));
  const remaining = parseNonNegativeInt(headers.get('x-ratelimit-remaining'));
  if (limit === null || remaining === null) {
    return null;
  }
  const reset = parseNonNegativeInt(headers.get('x-ratelimit-reset'));
  return {
    limit,
    remaining,
    resetEpoch: reset,
    fetchedAt,
  };
}

function parseNonNegativeInt(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * Analyze a signal for structural regime changes.
 * Endpoint: POST /v1/analyze/stream
 *
 * Returns both the response body and the parsed rate-limit headers (when
 * present) so the UI can show remaining quota.
 */
export async function analyze(
  request: AnalyzeRequest,
  opts: AlphaInfoRequestOptions,
): Promise<AnalyzeOutcome> {
  if (!opts.apiKey) {
    throw new AlphaInfoAuthError('API key is empty');
  }
  const url = buildUrl(opts.baseUrl, '/v1/analyze/stream');
  const raw = await requestRaw(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': opts.apiKey,
      },
      body: JSON.stringify(request),
    },
    opts,
  );
  const fetchedAt = Date.now();
  const body = (await raw.json()) as AnalyzeResponse;
  return {
    response: body,
    rateLimit: parseRateLimit(raw.headers, fetchedAt),
  };
}

/** Envelope returned by `analyzeBatch`, mirroring `AnalyzeOutcome`. */
export interface BatchOutcome {
  response: BatchAnalyzeResponse;
  rateLimit: RateLimitInfo | null;
}

/**
 * Analyze up to 100 signals in one request.
 * Endpoint: POST /v1/analyze/batch — each signal costs 1 analysis.
 *
 * Used by deep mode: the panel slices the visible series into N windows
 * client-side (the alphainfo SDK does the same — there is no dedicated
 * windowed endpoint) and submits them as one batch so a deep run is a
 * single HTTP round-trip on every tier's batch cap.
 */
export async function analyzeBatch(
  request: BatchAnalyzeRequest,
  opts: AlphaInfoRequestOptions,
): Promise<BatchOutcome> {
  if (!opts.apiKey) {
    throw new AlphaInfoAuthError('API key is empty');
  }
  const url = buildUrl(opts.baseUrl, '/v1/analyze/batch');
  const raw = await requestRaw(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': opts.apiKey,
      },
      body: JSON.stringify(request),
    },
    opts,
  );
  const fetchedAt = Date.now();
  const body = (await raw.json()) as BatchAnalyzeResponse;
  return {
    response: body,
    rateLimit: parseRateLimit(raw.headers, fetchedAt),
  };
}

/**
 * Liveness check. Does not require an API key.
 */
export function health(baseUrl?: string): Promise<HealthResponse> {
  return requestJson<HealthResponse>(
    buildUrl(baseUrl, '/health'),
    { method: 'GET' },
    { timeoutMs: 10_000 },
  );
}

/**
 * Audit replay payload. The alphainfo API returns the full recorded
 * request + response for a past analysis — shape is intentionally kept
 * open (`Record<string, unknown>`) because the plugin just pretty-prints
 * it in a modal. Callers that need typed access should narrow at the
 * point of use.
 */
export type AuditReplay = Record<string, unknown>;

/**
 * Fetch an auditable replay of a past analysis.
 * Endpoint: GET /v1/audit/replay/{analysis_id}
 *
 * Requires an API key — the backend always rejects anonymous requests
 * with 401, so we fetch server-side-via-browser with the same header the
 * `analyze()` call uses. Used by the in-plugin audit modal; do NOT try
 * to reach this endpoint via a plain `<a href>` click because a browser
 * tab cannot send custom headers.
 */
export async function auditReplay(
  analysisId: string,
  opts: AlphaInfoRequestOptions,
): Promise<AuditReplay> {
  if (!opts.apiKey) {
    throw new AlphaInfoAuthError('API key is empty');
  }
  if (!analysisId) {
    throw new AlphaInfoValidationError('analysis_id is empty');
  }
  const url = buildUrl(
    opts.baseUrl,
    `/v1/audit/replay/${encodeURIComponent(analysisId)}`,
  );
  return requestJson<AuditReplay>(
    url,
    {
      method: 'GET',
      headers: {
        'X-API-Key': opts.apiKey,
      },
    },
    opts,
  );
}
