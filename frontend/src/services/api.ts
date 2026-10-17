// API Service with hardened error handling

export interface ApiErrorDetails {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public errorDetails?: ApiErrorDetails
  ) {
    super(`API Error ${status}: ${errorDetails?.message ?? statusText}`);
    this.name = 'ApiError';
  }
}

export interface ApiResponse<T> {
  data: T;
  status: number;
}

type ErrorInterceptor = (error: ApiError) => void;

const errorInterceptors: Map<number, ErrorInterceptor> = new Map([
  [401, () => { window.location.href = '/login'; }],
  [429, (err) => { console.warn('Rate limited:', err.errorDetails); }],
]);

async function parseErrorBody(response: Response): Promise<ApiErrorDetails | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    return JSON.parse(text) as ApiErrorDetails;
  } catch {
    return undefined;
  }
}

async function handleResponse<T>(response: Response): Promise<ApiResponse<T>> {
  if (!response.ok) {
    const errorDetails = await parseErrorBody(response);
    const apiError = new ApiError(response.status, response.statusText, errorDetails);
    const interceptor = errorInterceptors.get(response.status);
    if (interceptor) interceptor(apiError);
    throw apiError;
  }
  const data = await response.json() as T;
  return { data, status: response.status };
}

export async function apiGet<T>(url: string): Promise<ApiResponse<T>> {
  const response = await fetch(url, { method: 'GET' });
  return handleResponse<T>(response);
}

export async function apiPost<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(response);
}
