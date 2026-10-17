import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/legacyCompat', () => ({
  $httpLegacy: vi.fn(),
  legacyToJson: vi.fn(),
}));

import { get, post, addErrorInterceptor } from '../api';
import type { ApiError } from '../api';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function textResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      'content-type': 'text/plain',
      ...headers,
    },
  });
}

describe('API error handling', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns data on 2xx responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 1, name: 'test' }));

    const result = await get<{ id: number; name: string }>('/test');
    expect(result.data).toEqual({ id: 1, name: 'test' });
    expect(result.status).toBe(200);
  });

  it('throws ApiError on 401 JSON error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        { message: 'Unauthorized', details: { reason: 'token expired' } },
        401,
        { 'X-Request-ID': 'req-123' }
      )
    );

    try {
      await get('/protected');
      expect.fail('should have thrown');
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe(401);
      expect(error.message).toBe('Unauthorized');
      expect(error.requestId).toBe('req-123');
      expect(error.details).toEqual({ reason: 'token expired' });
    }
  });

  it('throws ApiError on 429 rate-limit error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        { error: 'Too many requests', suggestion: 'Retry after 30s' },
        429
      )
    );

    try {
      await get('/rate-limited');
      expect.fail('should have thrown');
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe(429);
      expect(error.message).toBe('Too many requests');
      expect(error.suggestion).toBe('Retry after 30s');
    }
  });

  it('throws ApiError on 500 text error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(textResponse('Internal Server Error', 500));

    try {
      await get('/broken');
      expect.fail('should have thrown');
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe(500);
      expect(error.message).toBe('Internal Server Error');
    }
  });

  it('runs error interceptors for HTTP errors', async () => {
    const interceptor = vi.fn((e: ApiError) => {
      e.details = { ...e.details, intercepted: true };
      return e;
    });
    const remove = addErrorInterceptor(interceptor);

    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({ message: 'Forbidden' }, 403)
    );

    try {
      await get('/forbidden');
      expect.fail('should have thrown');
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe(403);
      expect(error.details).toEqual({ intercepted: true });
    } finally {
      remove();
    }
  });

  it('handles aborted requests (timeout)', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        }, 100);
      });
    });

    try {
      await get('/slow', undefined, { timeout: 5, retries: 0 });
      expect.fail('should have thrown');
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe(408);
      expect(error.message).toBe('Request timed out');
    }
  }, 10000);

  it('handles network errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    try {
      await post('/unreachable', undefined, undefined, { retries: 0 });
      expect.fail('should have thrown');
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe(0);
      expect(error.message).toBe('Network error');
    }
  });

  it('preserves suggestion field from JSON error body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        { message: 'Rate limited', suggestion: 'Wait 60s before retrying' },
        429
      )
    );

    try {
      await get('/slow');
      expect.fail('should have thrown');
    } catch (err) {
      const error = err as ApiError;
      expect(error.suggestion).toBe('Wait 60s before retrying');
    }
  });

  it('preserves structured error details from JSON body', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          message: 'Validation failed',
          details: { field: 'email', constraint: 'must be valid' },
        },
        422
      )
    );

    try {
      await post('/validate', { email: 'bad' });
      expect.fail('should have thrown');
    } catch (err) {
      const error = err as ApiError;
      expect(error.code).toBe(422);
      expect(error.details).toEqual({ field: 'email', constraint: 'must be valid' });
    }
  });

  it('does not retry POST requests on error', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(jsonResponse({ message: 'Error' }, 500));
    });

    try {
      await post('/submit', { data: 1 }, undefined, { retries: 3 });
      expect.fail('should have thrown');
    } catch {
      expect(callCount).toBe(1);
    }
  });
});
