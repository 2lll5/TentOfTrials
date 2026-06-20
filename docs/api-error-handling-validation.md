# API Error Handling Validation

This change keeps successful responses on the existing response-interceptor path
and sends non-2xx HTTP responses through the same normalized error path used for
timeouts and network failures.

## Covered cases

| Case | Expected behavior |
| --- | --- |
| 2xx JSON response | `request<T>()` resolves with `ApiResponse<T>` and response interceptors still run. |
| 401 JSON error | The JSON body is parsed, mapped into `ApiError.message`, `details`, `requestId`, and `path`, then passed through error interceptors. |
| 429 JSON error | The normalized `ApiError` preserves status `429`, request metadata, body details, and the rate-limit suggestion. Error interceptors still run after retry handling completes. |
| 500 text error | The text body becomes `ApiError.message`; the raw text is also preserved in `details.body`. |
| Aborted request | Existing `AbortError` handling remains compatible and normalizes to code `408`. |
| Network failure | Existing `TypeError: fetch` handling remains compatible and normalizes to code `0`. |

## Implementation notes

- `parseResponse()` now safely reads JSON bodies from text first so error bodies
  can be preserved even when the server sends unexpected JSON-shaped content.
- Non-OK HTTP responses are converted into `ApiError` before response
  interceptors run, so callers no longer receive 4xx/5xx responses as
  successful data.
- HTTP 4xx responses do not retry except timeout/rate-limit-style statuses,
  which avoids repeated 401 requests while preserving existing GET retry
  behavior for transient failures.
- The final normalized error is always passed through the registered error
  interceptor chain before being thrown.

## Local validation commands

```sh
cd frontend
npm run build

cd ..
python3 build.py
git diff --check
```
