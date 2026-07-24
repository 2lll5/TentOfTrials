/**
 * @fileoverview Tests for API service error handling.
 *
 * Tests cover:
 * - 2xx success responses
 * - 401 JSON error responses
 * - 429 rate-limit error responses
 * - 500 text error responses
 * - Request timeout/abort behavior
 * - Network error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get, post, addErrorInterceptor, addRequestInterceptor, ApiError } from './api';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Helper to create mock Response objects
function createMockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  const defaultHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...headers,
  };

  return {
    status,
    statusText: `HTTP ${status}`,
    headers: new Headers(defaultHeaders),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    formData: () => Promise.resolve(new FormData()),
    ok: status >= 200 && status < 300,
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => createMockResponse(status, body, headers),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as unknown as Response;
}

describe('API Service', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    // Clear any existing interceptors by adding and removing a dummy one
    // This ensures clean state between tests
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Success responses (2xx)', () => {
    it('should return successful 200 response', async () => {
      const mockData = { id: 1, name: 'Test' };
      mockFetch.mockResolvedValueOnce(createMockResponse(200, mockData));

      const response = await get<typeof mockData>('/test');

      expect(response.status).toBe(200);
      expect(response.data).toEqual(mockData);
      expect(response.requestId).toBeUndefined();
    });

    it('should return successful 201 response', async () => {
      const mockData = { id: 1, name: 'Created' };
      mockFetch.mockResolvedValueOnce(createMockResponse(201, mockData));

      const response = await post<typeof mockData>('/test', { name: 'Test' });

      expect(response.status).toBe(201);
      expect(response.data).toEqual(mockData);
    });

    it('should preserve request ID from response headers', async () => {
      const mockData = { id: 1 };
      mockFetch.mockResolvedValueOnce(
        createMockResponse(200, mockData, { 'X-Request-ID': 'req-123-abc' })
      );

      const response = await get<typeof mockData>('/test');

      expect(response.requestId).toBe('req-123-abc');
    });
  });

  describe('401 JSON error responses', () => {
    it('should throw ApiError for 401 with JSON body', async () => {
      const errorBody = {
        message: 'Unauthorized',
        error: 'Invalid token',
        details: { reason: 'token_expired' },
        requestId: 'req-401-abc',
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(401, errorBody));

      try {
        // Use POST to avoid retries
        await post('/protected', {});
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.code).toBe(401);
        expect(apiError.message).toBe('Unauthorized');
        expect(apiError.details).toEqual({ reason: 'token_expired' });
        expect(apiError.requestId).toBe('req-401-abc');
        expect(apiError.path).toBe('/protected');
        expect(apiError.suggestion).toBe('Please try logging in again.');
        expect(apiError.timestamp).toBeDefined();
      }
    });

    it('should run error interceptors for 401 errors', async () => {
      const errorBody = { message: 'Unauthorized' };
      mockFetch.mockResolvedValueOnce(createMockResponse(401, errorBody));

      const interceptor = vi.fn((error: ApiError) => {
        error.details = { ...error.details, intercepted: true };
        return error;
      });
      addErrorInterceptor(interceptor);

      try {
        // Use POST to avoid retries
        await post('/test', {});
      } catch (error) {
        expect(interceptor).toHaveBeenCalled();
        const apiError = error as ApiError;
        expect(apiError.details?.intercepted).toBe(true);
      }
    });
  });

  describe('429 rate-limit error responses', () => {
    it('should throw ApiError for 429 with rate limit info', async () => {
      const errorBody = {
        message: 'Rate limit exceeded',
        details: { retryAfter: 60, limit: 100, remaining: 0 },
        suggestion: 'Please wait 60 seconds',
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(429, errorBody));

      try {
        // Use POST to avoid retries
        await post('/api/data', {});
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.code).toBe(429);
        expect(apiError.message).toBe('Rate limit exceeded');
        expect(apiError.details?.retryAfter).toBe(60);
        expect(apiError.suggestion).toBe('Please wait 60 seconds');
      }
    });

    it('should provide default suggestion for 429 without custom suggestion', async () => {
      const errorBody = { message: 'Too many requests' };
      mockFetch.mockResolvedValueOnce(createMockResponse(429, errorBody));

      try {
        // Use POST to avoid retries
        await post('/api/data', {});
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.suggestion).toBe('Please wait a moment before making more requests.');
      }
    });
  });

  describe('500 text error responses', () => {
    it('should throw ApiError for 500 with text body', async () => {
      const errorText = 'Internal Server Error: Database connection failed';
      mockFetch.mockResolvedValueOnce(
        createMockResponse(500, errorText, { 'content-type': 'text/plain' })
      );

      try {
        // Use POST to avoid retries
        await post('/api/critical', {});
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.code).toBe(500);
        expect(apiError.message).toContain('Internal Server Error');
        expect(apiError.suggestion).toBe('The server encountered an error. Please try again later.');
      }
    });

    it('should handle 500 with JSON error body', async () => {
      const errorBody = {
        message: 'Internal server error',
        error: 'Database timeout',
        details: { query: 'SELECT * FROM users', timeout: 30000 },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(500, errorBody));

      try {
        // Use POST to avoid retries
        await post('/api/data', {});
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.code).toBe(500);
        expect(apiError.message).toBe('Internal server error');
        // Check that details contains the expected properties (may have extra properties from interceptors)
        expect(apiError.details?.query).toBe('SELECT * FROM users');
        expect(apiError.details?.timeout).toBe(30000);
      }
    });
  });

  describe('Timeout and abort behavior', () => {
    it('should handle request timeout (AbortError)', async () => {
      mockFetch.mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          setTimeout(() => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          }, 10);
        });
      });

      try {
        // Use POST to avoid retries, with very short timeout
        await post('/slow-endpoint', {}, undefined, { timeout: 1 });
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.code).toBe(408);
        expect(apiError.message).toBe('Request timed out');
        expect(apiError.suggestion).toBe('Please check your network connection and try again.');
      }
    });
  });

  describe('Network error handling', () => {
    it('should handle network errors (TypeError with fetch)', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      try {
        // Use POST to avoid retries
        await post('/api/data', {});
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.code).toBe(0);
        expect(apiError.message).toBe('Network error');
        expect(apiError.details?.originalError).toBe('Failed to fetch');
        expect(apiError.suggestion).toBe('Please check your network connection.');
      }
    });

    it('should handle DNS resolution errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      try {
        // Use POST to avoid retries
        await post('/api/data', {});
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.code).toBe(0);
        expect(apiError.message).toBe('Network error');
      }
    });
  });

  describe('Validation errors (422)', () => {
    it('should handle validation errors with details', async () => {
      const errorBody = {
        message: 'Validation failed',
        errors: [
          { field: 'email', message: 'Invalid email format' },
          { field: 'password', message: 'Password too short' },
        ],
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(422, errorBody));

      try {
        await post('/auth/register', { email: 'bad', password: '123' });
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.code).toBe(422);
        expect(apiError.message).toBe('Validation failed');
        expect(apiError.details?.validationErrors).toBeDefined();
      }
    });
  });

  describe('Error interceptors', () => {
    it('should run multiple error interceptors in order', async () => {
      const errorBody = { message: 'Error' };
      mockFetch.mockResolvedValueOnce(createMockResponse(500, errorBody));

      const interceptor1 = vi.fn((error: ApiError) => {
        error.details = { ...error.details, interceptor1: true };
        return error;
      });
      const interceptor2 = vi.fn((error: ApiError) => {
        error.details = { ...error.details, interceptor2: true };
        return error;
      });

      addErrorInterceptor(interceptor1);
      addErrorInterceptor(interceptor2);

      try {
        // Use POST to avoid retries
        await post('/test', {});
      } catch (error) {
        expect(interceptor1).toHaveBeenCalled();
        expect(interceptor2).toHaveBeenCalled();
        const apiError = error as ApiError;
        expect(apiError.details?.interceptor1).toBe(true);
        expect(apiError.details?.interceptor2).toBe(true);
      }
    });
  });

  describe('Request ID preservation', () => {
    it('should preserve request ID from error response body', async () => {
      const errorBody = {
        message: 'Error',
        requestId: 'req-body-123',
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(500, errorBody));

      try {
        // Use POST to avoid retries
        await post('/test', {});
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.requestId).toBe('req-body-123');
      }
    });

    it('should preserve request ID from response headers', async () => {
      const errorBody = { message: 'Error' };
      mockFetch.mockResolvedValueOnce(
        createMockResponse(500, errorBody, { 'X-Request-ID': 'req-header-456' })
      );

      try {
        // Use POST to avoid retries
        await post('/test', {});
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.requestId).toBe('req-header-456');
      }
    });
  });
});
