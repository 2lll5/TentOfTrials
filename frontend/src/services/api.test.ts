import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addErrorInterceptor, get } from './api';

describe('api request error handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let warnMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    warnMock = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
    });
  });

  afterEach(() => {
    warnMock.mockRestore();
    vi.unstubAllGlobals();
  });

  it('returns parsed data for 2xx responses', async () => {
    fetchMock.mockResolvedValue(responseJson({ ok: true }, 200));

    await expect(get<{ ok: boolean }>('/health')).resolves.toMatchObject({
      data: { ok: true },
      status: 200,
    });
  });

  it('throws normalized ApiError for 401 JSON responses and runs error interceptors', async () => {
    const seenCodes: number[] = [];
    const removeInterceptor = addErrorInterceptor((error) => {
      seenCodes.push(error.code);
      return { ...error, suggestion: 'Sign in again.' };
    });
    fetchMock.mockResolvedValue(responseJson({
      message: 'Token expired',
      details: { reason: 'expired' },
      path: '/auth/me',
    }, 401, { 'X-Request-ID': 'req-401' }));

    await expect(get('/auth/me')).rejects.toMatchObject({
      code: 401,
      message: 'Token expired',
      details: { reason: 'expired' },
      requestId: 'req-401',
      path: '/auth/me',
      suggestion: 'Sign in again.',
    });
    expect(seenCodes).toEqual([401]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    removeInterceptor();
  });

  it('preserves rate-limit response details for 429 JSON responses', async () => {
    const seenCodes: number[] = [];
    const removeInterceptor = addErrorInterceptor((error) => {
      seenCodes.push(error.code);
      return error;
    });
    fetchMock.mockResolvedValue(responseJson({
      error: 'Too many requests',
      details: { retryAfterSeconds: 30 },
      requestId: 'body-req-429',
      path: '/orders',
    }, 429));

    await expect(get('/orders')).rejects.toMatchObject({
      code: 429,
      message: 'Too many requests',
      details: { retryAfterSeconds: 30 },
      requestId: 'body-req-429',
      path: '/orders',
    });
    expect(seenCodes).toEqual([429]);
    removeInterceptor();
  });

  it('maps text error bodies into ApiError message and details', async () => {
    fetchMock.mockResolvedValue(new Response('upstream failed', {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'text/plain' },
    }));

    await expect(get('/reports')).rejects.toMatchObject({
      code: 500,
      message: 'upstream failed',
      details: { body: 'upstream failed' },
      path: '/reports',
    });
  });

  it('keeps aborted request normalization compatible with existing timeout handling', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    await expect(get('/slow', undefined, { retries: 0 })).rejects.toMatchObject({
      code: 408,
      message: 'Request timed out',
    });
  });

  it('keeps network failures normalized by the existing path', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(get('/offline', undefined, { retries: 0 })).rejects.toMatchObject({
      code: 0,
      message: 'Network error',
    });
  });
});

function responseJson(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}
