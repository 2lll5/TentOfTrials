/**
 * Validation tests for API error handling.
 *
 * Run: npx tsx src/services/__tests__/api-error-handling.test.ts
 *
 * These tests verify the hardened error handling behavior of the API service layer.
 * They use a mock fetch to simulate various HTTP response scenarios.
 */

import { get, addErrorInterceptor, type ApiError } from '../api';

// ---------------------------------------------------------------------------
// MOCK ENVIRONMENT (Node.js doesn't have localStorage or window)
// ---------------------------------------------------------------------------

if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } as Storage;
}

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}

// ---------------------------------------------------------------------------
// MOCK FETCH
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : `Error ${status}`,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function textResponse(body: string, status = 200, headers?: Record<string, string>): Response {
  return new Response(body, {
    status,
    statusText: status === 200 ? 'OK' : `Error ${status}`,
    headers: {
      'content-type': 'text/plain',
      ...headers,
    },
  });
}

// ---------------------------------------------------------------------------
// TEST HELPERS
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// TESTS
// ---------------------------------------------------------------------------

async function run() {
  console.log('\nAPI Error Handling Validation Tests\n');

  // ---- 2xx SUCCESS ----
  await test('200 OK returns ApiResponse with data', async () => {
    mockFetch(async () =>
      jsonResponse({ id: 1, name: 'test' }, 200, { 'X-Request-ID': 'req-abc' })
    );
    try {
      const response = await get<{ id: number; name: string }>('/test');
      assert(response.status === 200, `Expected status 200, got ${response.status}`);
      assert(response.data.id === 1, `Expected data.id === 1`);
      assert(response.requestId === 'req-abc', `Expected requestId req-abc`);
    } finally {
      restoreFetch();
    }
  });

  // ---- 401 JSON ERROR ----
  await test('401 JSON error throws ApiError with code 401', async () => {
    mockFetch(async () =>
      jsonResponse(
        { message: 'Unauthorized', details: { reason: 'token_expired' } },
        401,
        { 'X-Request-ID': 'req-401' }
      )
    );
    try {
      await get('/protected');
      throw new Error('Expected throw but got response');
    } catch (err) {
      const apiErr = err as ApiError;
      assert(apiErr.code === 401, `Expected code 401, got ${apiErr.code}`);
      assert(apiErr.message === 'Unauthorized', `Expected message 'Unauthorized', got '${apiErr.message}'`);
      assert(apiErr.requestId === 'req-401', `Expected requestId req-401`);
      assert(!!apiErr.suggestion && apiErr.suggestion.includes('log in'), `Expected suggestion about logging in`);
    } finally {
      restoreFetch();
    }
  });

  // ---- 429 RATE LIMIT ----
  await test('429 rate-limit error throws ApiError with code 429', async () => {
    mockFetch(async () =>
      jsonResponse({ message: 'Too Many Requests' }, 429)
    );
    try {
      await get('/rate-limited');
      throw new Error('Expected throw but got response');
    } catch (err) {
      const apiErr = err as ApiError;
      assert(apiErr.code === 429, `Expected code 429, got ${apiErr.code}`);
      assert(!!apiErr.suggestion && apiErr.suggestion.includes('Rate limit'), `Expected rate limit suggestion`);
    } finally {
      restoreFetch();
    }
  });

  // ---- 500 TEXT ERROR ----
  await test('500 text error throws ApiError with code 500', async () => {
    mockFetch(async () =>
      textResponse('Internal Server Error', 500)
    );
    try {
      await get('/server-error');
      throw new Error('Expected throw but got response');
    } catch (err) {
      const apiErr = err as ApiError;
      assert(apiErr.code === 500, `Expected code 500, got ${apiErr.code}`);
      assert(apiErr.message === 'Internal Server Error', `Expected 'Internal Server Error', got '${apiErr.message}'`);
      assert(!!apiErr.suggestion && apiErr.suggestion.includes('Server error'), `Expected server error suggestion`);
    } finally {
      restoreFetch();
    }
  });

  // ---- 404 NOT FOUND ----
  await test('404 error throws ApiError with code 404', async () => {
    mockFetch(async () =>
      jsonResponse({ message: 'Not Found' }, 404)
    );
    try {
      await get('/missing');
      throw new Error('Expected throw but got response');
    } catch (err) {
      const apiErr = err as ApiError;
      assert(apiErr.code === 404, `Expected code 404, got ${apiErr.code}`);
      assert(!!apiErr.suggestion && apiErr.suggestion.includes('not found'), `Expected not found suggestion`);
    } finally {
      restoreFetch();
    }
  });

  // ---- ERROR INTERCEPTORS FIRE ----
  await test('Error interceptors run for HTTP errors', async () => {
    const intercepted: ApiError[] = [];
    const remove = addErrorInterceptor((err) => {
      intercepted.push({ ...err });
      return err;
    });

    mockFetch(async () =>
      jsonResponse({ message: 'Forbidden' }, 403)
    );
    try {
      await get('/forbidden');
      throw new Error('Expected throw');
    } catch {
      assert(intercepted.length === 1, `Expected 1 interceptor call, got ${intercepted.length}`);
      assert(intercepted[0].code === 403, `Expected interceptor code 403`);
    } finally {
      remove();
      restoreFetch();
    }
  });

  // ---- TIMEOUT ----
  await test('Timeout throws ApiError with code 408', async () => {
    // Simulate an abort by having fetch check the signal and throw
    mockFetch(async (_url, init) => {
      return new Promise<never>((_, reject) => {
        const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (init?.signal?.aborted) {
          onAbort();
          return;
        }
        init?.signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    try {
      await get('/slow', undefined, { timeout: 1 });
      throw new Error('Expected throw');
    } catch (err) {
      const apiErr = err as ApiError;
      assert(apiErr.code === 408, `Expected code 408, got ${apiErr.code}`);
      assert(apiErr.message.includes('timed out'), `Expected timeout message`);
    } finally {
      restoreFetch();
    }
  });

  // ---- NETWORK ERROR ----
  await test('Network error throws ApiError', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    try {
      await get('/unreachable');
      throw new Error('Expected throw');
    } catch (err) {
      const apiErr = err as ApiError;
      assert(apiErr.code === 0, `Expected code 0, got ${apiErr.code}`);
      assert(apiErr.message.includes('Network error'), `Expected network error message`);
    } finally {
      restoreFetch();
    }
  });

  // ---- SUMMARY ----
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
