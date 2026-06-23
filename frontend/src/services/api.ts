// frontend/src/services/api.ts
// Harden API response error handling – Issue #1

import { ApiError } from '../types/api-error';

// Define generic API response type unchanged for backward compatibility
export interface ApiResponse<T> {
  data: T;
  status: number;
  ok: boolean;
  error?: ApiErrorPayload;
}

interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

// Error interceptor type
type ErrorInterceptor = (error: ApiError) => Promise<ApiError | void>;

// Default interceptors
const defaultInterceptors: ErrorInterceptor[] = [
  async (error: ApiError) => {
    if (error.status === 401) {
      // Redirect to login or refresh token
      window.location.href = '/login';
      return;
    }
    if (error.status === 429) {
      // Rate limit – wait and retry once
      const retryAfter = parseInt(error.headers.get('Retry-After') || '1', 10);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      // Return the original error to allow caller to decide retry
      return error;
    }
    return error;
  },
];

export class ApiClient {
  private baseUrl: string;
  private errorInterceptors: ErrorInterceptor[];

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
    this.errorInterceptors = [...defaultInterceptors];
  }

  addErrorInterceptor(interceptor: ErrorInterceptor): void {
    this.errorInterceptors.push(interceptor);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestInit,
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options?.headers as Record<string, string>) || {}),
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      ...options,
    };

    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (error) {
      // Network error
      throw new ApiError(0, 'Network error', new Headers(), error);
    }

    // Build common response shape
    const apiResponse: ApiResponse<T> = {
      status: response.status,
      ok: response.ok,
      data: null as unknown as T,
    };

    if (!response.ok) {
      // Try to extract structured error payload
      let errorPayload: ApiErrorPayload | undefined;
      try {
        const bodyText = await response.text();
        if (bodyText) {
          errorPayload = JSON.parse(bodyText);
        }
      } catch {
        // Body is not JSON or empty
      }

      const apiError = new ApiError(
        response.status,
        errorPayload?.message || response.statusText,
        response.headers,
        errorPayload,
      );

      // Run error interceptors
      let processedError: ApiError | void = apiError;
      for (const interceptor of this.errorInterceptors) {
        try {
          processedError = await interceptor(processedError || apiError);
        } catch (interceptorError) {
          // If interceptor throws, use that as final error
          processedError = interceptorError as ApiError;
          break;
        }
        if (processedError === undefined) {
          // Interceptor handled the error (e.g., redirect) – break chain
          break;
        }
      }

      // If any interceptor returned undefined, we consider it handled and return a successful response?
      // Actually, interceptor may have resolved the issue (e.g., retried). But since we already have the error,
      // the safest is to throw the (possibly modified) error.
      if (processedError && processedError !== apiError) {
        throw processedError;
      }

      // Otherwise, re-throw original error
      throw apiError;
    }

    // Successful response: parse body
    try {
      const bodyText = await response.text();
      if (bodyText) {
        apiResponse.data = JSON.parse(bodyText);
      } else {
        apiResponse.data = {} as T;
      }
    } catch {
      // If parsing fails, set data to null
      apiResponse.data = null as unknown as T;
    }

    return apiResponse;
  }

  async get<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T>(path: string, body?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body, options);
  }

  async put<T>(path: string, body?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body, options);
  }

  async delete<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  async patch<T>(path: string, body?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, body, options);
  }
}

// Export a singleton instance with default base URL
export const apiClient = new ApiClient();

// Also export ApiError class for external use
export class ApiError extends Error {
  public status: number;
  public headers: Headers;
  public details?: unknown;

  constructor(status: number, message: string, headers: Headers, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.headers = headers;
    this.details = details;
  }
}
