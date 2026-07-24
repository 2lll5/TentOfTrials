# API Service Error Handling Validation

## Scenarios

### 1. 2xx Success
- `fetch` returns status 200 with JSON body `{"id": 1, "name": "test"}`
- `request()` resolves with `ApiResponse<{id:number;name:string}>` containing the data
- Response interceptors run
- No error thrown

### 2. 401 JSON Error
- `fetch` returns status 401, `Content-Type: application/json`
- Body: `{"message": "Unauthorized", "requestId": "req-123"}`
- `request()` throws `ApiError` with `code: 401`, `message: "Unauthorized"`, `requestId: "req-123"`
- Error interceptor runs (logs "Authentication failed, attempting token refresh...")

### 3. 429 Rate-Limit Error
- `fetch` returns status 429, `Content-Type: application/json`
- Body: `{"message": "Rate limit exceeded", "details": {"retryAfter": 30}}`
- `request()` throws `ApiError` with `code: 429`, `details.retryAfter: 30`
- Error interceptor runs (logs "Rate limit exceeded, retrying with backoff...")

### 4. 500 Text Error
- `fetch` returns status 500, `Content-Type: text/plain`
- Body: `Internal Server Error`
- `request()` throws `ApiError` with `code: 500`, `message: "Internal Server Error"`

### 5. Timeout (AbortError)
- `fetch` does not resolve within `DEFAULT_TIMEOUT` (30s)
- `AbortController` aborts the request
- `request()` throws `ApiError` with `code: 408`, `message: "Request timed out"`

### 6. Network Failure
- `fetch` throws `TypeError` with message containing "fetch"
- `request()` throws `ApiError` with `code: 0`, `message: "Network error"`

## Error Flow

```
fetch response
  ├── response.ok (2xx) → parseResponse → responseInterceptors → resolve ApiResponse<T>
  └── !response.ok (4xx/5xx)
        ├── parse JSON error body → ApiError { code, message, details, requestId }
        ├── or parse text error body → ApiError { code, message }
        ├── errorInterceptors (401 → token refresh, 429 → rate-limit warning)
        └── throw ApiError
```

## Manual Verification

```typescript
// Mock scenarios using a local test server or by intercepting fetch
// Each scenario below is a standalone test

// Scenario 1: 200 success
// Scenario 2: 401 with JSON body
// Scenario 3: 429 with JSON body
// Scenario 4: 500 with text body
// Scenario 5: Abort signal timeout
// Scenario 6: Network failure (fetch TypeError)
```
