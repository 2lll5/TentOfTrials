// api.test.ts - Test suite for hardened API response error handling.
import assert from 'assert';

// Define global mock objects before importing the api module
const mockStorage: Record<string, string> = {};
global.localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
  length: 0,
  key: (index: number) => null,
} as unknown as Storage;

// We will mock fetch globally
let mockFetch: any = null;
global.fetch = async (url: any, init: any) => {
  if (mockFetch) {
    return mockFetch(url, init);
  }
  throw new TypeError('Failed to fetch (mock fetch not configured)');
};

// Now import the api service methods
import { get, post, addErrorInterceptor, ApiError } from './api';

// Helper to create a mock Response
function createMockResponse(
  status: number,
  statusText: string,
  headers: Record<string, string>,
  bodyText: string
): Response {
  const headerMap = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) {
    headerMap.set(k.toLowerCase(), v);
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) || null,
    } as any,
    json: async () => JSON.parse(bodyText),
    text: async () => bodyText,
  } as unknown as Response;
}

async function runTests() {
  console.log('Running API Client Tests...');

  // Setup simple error tracking in interceptor
  const interceptedErrors: ApiError[] = [];
  const removeInterceptor = addErrorInterceptor((err) => {
    interceptedErrors.push(err);
    return err;
  });

  // Test Case 1: 2xx Success Response (JSON)
  {
    console.log(' - Test Case 1: 2xx Success (JSON)');
    mockFetch = async (url: string, init: any) => {
      return createMockResponse(
        200,
        'OK',
        { 'Content-Type': 'application/json', 'X-Page': '2', 'X-Total': '100' },
        JSON.stringify({ success: true, user: { id: 'u1' } })
      );
    };

    const res = await get<any>('/users/profile');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.data, { success: true, user: { id: 'u1' } });
    assert.ok(res.pagination);
    assert.strictEqual(res.pagination.page, 2);
    assert.strictEqual(res.pagination.total, 100);
  }

  // Test Case 2: 401 Unauthorized Response (JSON error payload)
  {
    console.log(' - Test Case 2: 401 JSON Error');
    interceptedErrors.length = 0;
    mockFetch = async (url: string, init: any) => {
      return createMockResponse(
        401,
        'Unauthorized',
        { 'Content-Type': 'application/json', 'X-Request-ID': 'req-abc-123' },
        JSON.stringify({
          error: {
            message: 'Session expired',
            details: { reason: 'token_expired' },
            path: '/users/profile'
          }
        })
      );
    };

    try {
      await get('/users/profile');
      assert.fail('Should have thrown on 401');
    } catch (err: any) {
      const apiErr = err as ApiError;
      assert.strictEqual(apiErr.code, 401);
      assert.strictEqual(apiErr.message, 'Session expired');
      assert.strictEqual(apiErr.requestId, 'req-abc-123');
      assert.strictEqual(apiErr.path, '/users/profile');
      assert.deepStrictEqual(apiErr.details, { reason: 'token_expired' });
      assert.ok(apiErr.suggestion);

      // Verify interceptor caught it
      assert.strictEqual(interceptedErrors.length, 1);
      assert.strictEqual(interceptedErrors[0].code, 401);
      assert.strictEqual(interceptedErrors[0].message, 'Session expired');
    }
  }

  // Test Case 3: 429 Too Many Requests (JSON error payload)
  {
    console.log(' - Test Case 3: 429 Rate Limit JSON Error');
    interceptedErrors.length = 0;
    mockFetch = async (url: string, init: any) => {
      return createMockResponse(
        429,
        'Too Many Requests',
        { 'Content-Type': 'application/json' },
        JSON.stringify({
          message: 'Rate limit exceeded',
          details: { retryAfter: 60 }
        })
      );
    };

    try {
      await post('/auth/login', { username: 'test' });
      assert.fail('Should have thrown on 429');
    } catch (err: any) {
      const apiErr = err as ApiError;
      assert.strictEqual(apiErr.code, 429);
      assert.strictEqual(apiErr.message, 'Rate limit exceeded');
      assert.deepStrictEqual(apiErr.details, { retryAfter: 60 });
      assert.ok(apiErr.suggestion);

      assert.strictEqual(interceptedErrors.length, 1);
      assert.strictEqual(interceptedErrors[0].code, 429);
    }
  }

  // Test Case 4: 500 Internal Server Error (Raw Text)
  {
    console.log(' - Test Case 4: 500 Server Error (Raw Text)');
    interceptedErrors.length = 0;
    mockFetch = async (url: string, init: any) => {
      return createMockResponse(
        500,
        'Internal Server Error',
        { 'Content-Type': 'text/plain', 'X-Request-ID': 'req-err-999' },
        'Fatal database connection failure'
      );
    };

    try {
      await get('/admin/health');
      assert.fail('Should have thrown on 500');
    } catch (err: any) {
      const apiErr = err as ApiError;
      assert.strictEqual(apiErr.code, 500);
      assert.strictEqual(apiErr.message, 'Fatal database connection failure');
      assert.strictEqual(apiErr.requestId, 'req-err-999');
      assert.ok(apiErr.suggestion);

      assert.strictEqual(interceptedErrors.length, 1);
      assert.strictEqual(interceptedErrors[0].code, 500);
    }
  }

  // Test Case 5: Timeout (Aborted Request)
  {
    console.log(' - Test Case 5: Request Timeout (AbortError)');
    interceptedErrors.length = 0;
    mockFetch = async (url: string, init: any) => {
      const err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      throw err;
    };

    try {
      await get('/users/preferences', undefined, { timeout: 100 });
      assert.fail('Should have thrown on timeout abort');
    } catch (err: any) {
      const apiErr = err as ApiError;
      assert.strictEqual(apiErr.code, 408);
      assert.strictEqual(apiErr.message, 'Request timed out');
      assert.ok(apiErr.suggestion);

      assert.strictEqual(interceptedErrors.length, 1);
      assert.strictEqual(interceptedErrors[0].code, 408);
    }
  }

  // Test Case 6: Network Failure
  {
    console.log(' - Test Case 6: Network Failure (Failed to fetch)');
    interceptedErrors.length = 0;
    mockFetch = async (url: string, init: any) => {
      throw new TypeError('Failed to fetch');
    };

    try {
      await get('/users/preferences');
      assert.fail('Should have thrown on network failure');
    } catch (err: any) {
      const apiErr = err as ApiError;
      assert.strictEqual(apiErr.code, 0);
      assert.strictEqual(apiErr.message, 'Network error');
      assert.ok(apiErr.suggestion);

      assert.strictEqual(interceptedErrors.length, 1);
      assert.strictEqual(interceptedErrors[0].code, 0);
    }
  }

  removeInterceptor();
  console.log('All API Client Tests Passed Successfully!');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
