import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get, post, addErrorInterceptor } from './api';

function mockFetch(responseOverrides: Partial<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  jsonBody: unknown;
  textBody: string;
}>) {
  const {
    status = 200,
    statusText = 'OK',
    headers = {},
    jsonBody,
    textBody = '',
  } = responseOverrides;

  const headersObj = new Map(Object.entries(headers));

  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (name: string) => headersObj.get(name) ?? null,
      forEach: (cb: (v: string, k: string) => void) => headersObj.forEach((v, k) => cb(v, k)),
    },
    json: jsonBody !== undefined
      ? vi.fn().mockResolvedValue(jsonBody)
      : vi.fn().mockRejectedValue(new Error('Not JSON')),
    text: vi.fn().mockResolvedValue(textBody),
    formData: vi.fn().mockRejectedValue(new Error('Not form data')),
  });
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('2xx success responses', () => {
  it('returns ApiResponse with data for a 200 JSON response', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name: string) => {
          if (name === 'content-type') return 'application/json';
          if (name === 'X-Request-ID') return 'req-123';
          return null;
        },
        forEach: () => {},
      },
      json: vi.fn().mockResolvedValue({ id: 1, name: 'test' }),
      text: vi.fn().mockRejectedValue(new Error('Not text')),
    });
    vi.stubGlobal('fetch', fetch);

    const result = await get<{ id: number; name: string }>('/test');

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ id: 1, name: 'test' });
    expect(result.requestId).toBe('req-123');
  });

  it('returns ApiResponse for a 200 text response', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name: string) => {
          if (name === 'content-type') return 'text/plain';
          return null;
        },
        forEach: () => {},
      },
      json: vi.fn().mockRejectedValue(new Error('Not JSON')),
      text: vi.fn().mockResolvedValue('plain text response'),
    });
    vi.stubGlobal('fetch', fetch);

    const result = await get<string>('/test');

    expect(result.status).toBe(200);
    expect(result.data).toBe('plain text response');
  });
});

describe('HTTP error responses', () => {
  it('401 JSON error: rejects with ApiError containing message from body', async () => {
    vi.stubGlobal('fetch', mockFetch({
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'content-type': 'application/json', 'X-Request-ID': 'req-401' },
      jsonBody: { message: 'Invalid or expired token', code: 401 },
    }));

    await expect(get('/auth/profile')).rejects.toMatchObject({
      code: 401,
      message: 'Invalid or expired token',
      requestId: 'req-401',
      path: '/auth/profile',
      suggestion: 'Please try logging in again.',
    });
  });

  it('401 triggers error interceptors', async () => {
    const interceptorFn = vi.fn((err: any) => err);
    const remove = addErrorInterceptor(interceptorFn);

    vi.stubGlobal('fetch', mockFetch({
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'content-type': 'application/json' },
      jsonBody: { message: 'Unauthorized' },
    }));

    await expect(get('/auth/profile')).rejects.toThrow();
    expect(interceptorFn).toHaveBeenCalled();

    remove();
  });

  it('429 rate-limit error: rejects with ApiError and default suggestion', async () => {
    vi.stubGlobal('fetch', mockFetch({
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'content-type': 'application/json' },
      jsonBody: { message: 'Rate limit exceeded', retryAfter: 30 },
    }));

    await expect(get('/market/quotes')).rejects.toMatchObject({
      code: 429,
      message: 'Rate limit exceeded',
      suggestion: 'Please wait a moment before making more requests.',
    });
  });

  it('429 triggers error interceptors', async () => {
    const interceptorFn = vi.fn((err: any) => err);
    const remove = addErrorInterceptor(interceptorFn);

    vi.stubGlobal('fetch', mockFetch({
      status: 429,
      statusText: 'Too Many Requests',
      headers: { 'content-type': 'application/json' },
      jsonBody: { message: 'Rate limit hit' },
    }));

    await expect(get('/market/quotes')).rejects.toThrow();
    expect(interceptorFn).toHaveBeenCalled();

    remove();
  });

  it('500 text error: rejects with ApiError containing text body as message', async () => {
    vi.stubGlobal('fetch', mockFetch({
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'text/plain' },
      textBody: 'Internal server error occurred',
    }));

    await expect(get('/admin/health')).rejects.toMatchObject({
      code: 500,
      message: 'Internal server error occurred',
      suggestion: 'The server encountered an error. Please try again later.',
    });
  });

  it('500 with JSON error body preserves structured details', async () => {
    vi.stubGlobal('fetch', mockFetch({
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'application/json', 'X-Request-ID': 'req-500' },
      jsonBody: {
        message: 'Database connection failed',
        details: { cause: 'connection timeout', host: 'db-primary' },
        requestId: 'req-500',
        suggestion: 'Retry the request',
      },
    }));

    await expect(get('/users')).rejects.toMatchObject({
      code: 500,
      message: 'Database connection failed',
      details: { cause: 'connection timeout', host: 'db-primary' },
      requestId: 'req-500',
      path: '/users',
      suggestion: 'Retry the request',
    });
  });

  it('403 error with validation errors array', async () => {
    vi.stubGlobal('fetch', mockFetch({
      status: 403,
      statusText: 'Forbidden',
      headers: { 'content-type': 'application/json' },
      jsonBody: {
        message: 'Validation failed',
        errors: [{ field: 'email', message: 'Invalid format' }],
      },
    }));

    await expect(get('/auth/register')).rejects.toMatchObject({
      code: 403,
      message: 'Validation failed',
      details: {
        validationErrors: [{ field: 'email', message: 'Invalid format' }],
      },
      suggestion: 'You do not have permission to access this resource.',
    });
  });

  it('404 error uses status text as fallback message when body is empty', async () => {
    vi.stubGlobal('fetch', mockFetch({
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'application/json' },
      jsonBody: {},
    }));

    await expect(get('/nonexistent')).rejects.toMatchObject({
      code: 404,
      message: 'Not Found',
      suggestion: 'The requested resource was not found.',
    });
  });
});

describe('timeout and network errors', () => {
  it('AbortError is normalized to ApiError with code 408 (timeout)', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    await expect(post('/slow-endpoint', {})).rejects.toMatchObject({
      code: 408,
      message: 'Request timed out',
      suggestion: 'Please check your network connection and try again.',
    });
  });

  it('network fetch error is normalized to ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(post('/test', {})).rejects.toMatchObject({
      code: 0,
      message: 'Network error',
      details: { originalError: 'Failed to fetch' },
      suggestion: 'Please check your network connection.',
    });
  });

  it('non-retryable POST network error does not retry', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchFn);

    await expect(post('/test', {})).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('retry behavior for GET requests', () => {
  it('retries GET on network error up to MAX_RETRIES', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => {
            if (name === 'content-type') return 'application/json';
            return null;
          },
          forEach: () => {},
        },
        json: vi.fn().mockResolvedValue({ success: true }),
        text: vi.fn().mockRejectedValue(new Error('Not text')),
      });
    vi.stubGlobal('fetch', fetchFn);

    const result = await get<{ success: boolean }>('/retry-test');

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ success: true });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  }, 30000);

  it('gives up after MAX_RETRIES and throws normalized error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchFn);

    await expect(get('/failing')).rejects.toMatchObject({
      code: 0,
      message: 'Network error',
    });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  }, 30000);
});
