import { ApiResponse, ApiError } from './types';

async function request<T>(url: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const response = await fetch(url, options);

    if (!response.ok) {
        const error: ApiError = await normalizeError(response);
        return Promise.reject(error);
    }

    const data: T = await response.json();
    return { data, status: response.status, requestId: response.headers.get('X-Request-ID') };
}

async function normalizeError(response: Response): Promise<ApiError> {
    const requestId = response.headers.get('X-Request-ID');
    const status = response.status;
    const path = response.url;
    let message = 'An error occurred';
    let details = {};

    try {
        if (response.headers.get('Content-Type')?.includes('application/json')) {
            details = await response.json();
            message = details.message || message;
        } else {
            message = await response.text();
        }
    } catch (e) {
        message = 'Failed to parse error response';
    }

    return { message, details, requestId, status, path };
}

// Example of existing error interceptors
function errorInterceptor(error: ApiError) {
    if (error.status === 401) {
        // Handle unauthorized error
    } else if (error.status === 429) {
        // Handle rate limit error
    }
    // Other error handling logic
}

// Usage of the request function
request('/api/data')
    .then(response => {
        console.log('Data:', response.data);
    })
    .catch(error => {
        errorInterceptor(error);
        console.error('API Error:', error);
    });