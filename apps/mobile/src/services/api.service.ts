/**
 * API Service — Axios HTTP client for the BidClean API.
 *
 * Handles:
 * - Base URL configuration
 * - Automatic Authorization header injection from auth store
 * - 401 response interception with token refresh + request retry
 * - Concurrent 401 handling (single refresh attempt, queued retries)
 */

import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';
import { useAuthStore } from '../stores/auth.store';
import { API_BASE_URL } from '../screens/auth/oauth.config';

// ─── Constants ───────────────────────────────────────────────────────────────

const AUTHORIZATION_HEADER = 'Authorization';
const BEARER_PREFIX = 'Bearer';

const HTTP_STATUS_UNAUTHORIZED = 401;

// ─── Refresh Queue ───────────────────────────────────────────────────────────

type FailedRequest = {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

let isRefreshing = false;
let failedRequestsQueue: FailedRequest[] = [];

function processQueue(error: unknown, token: string | null): void {
  failedRequestsQueue.forEach((pending) => {
    if (error || !token) {
      pending.reject(error);
    } else {
      pending.resolve(token);
    }
  });
  failedRequestsQueue = [];
}

// ─── Axios Instance ──────────────────────────────────────────────────────────

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── Request Interceptor ─────────────────────────────────────────────────────

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const accessToken = useAuthStore.getState().tokens?.accessToken ?? null;

    if (accessToken) {
      config.headers[AUTHORIZATION_HEADER] = `${BEARER_PREFIX} ${accessToken}`;
    }

    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

// ─── Response Interceptor ────────────────────────────────────────────────────

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    const isUnauthorized = error.response?.status === HTTP_STATUS_UNAUTHORIZED;
    const isAlreadyRetried = originalRequest?._retry;

    if (!isUnauthorized || isAlreadyRetried || !originalRequest) {
      return Promise.reject(error);
    }

    // Mark this request so we don't retry it twice
    originalRequest._retry = true;

    if (isRefreshing) {
      // Another refresh is in progress — queue this request
      return new Promise<string>((resolve, reject) => {
        failedRequestsQueue.push({ resolve, reject });
      }).then((newToken) => {
        originalRequest.headers[AUTHORIZATION_HEADER] =
          `${BEARER_PREFIX} ${newToken}`;
        return apiClient(originalRequest);
      });
    }

    isRefreshing = true;

    try {
      await useAuthStore.getState().refreshTokens();

      const newAccessToken =
        useAuthStore.getState().tokens?.accessToken ?? null;

      if (!newAccessToken) {
        // Refresh didn't produce a new token — force logout
        useAuthStore.getState().reset();
        processQueue(new Error('Token refresh failed'), null);
        return Promise.reject(error);
      }

      // Retry the original request with the new token
      originalRequest.headers[AUTHORIZATION_HEADER] =
        `${BEARER_PREFIX} ${newAccessToken}`;

      processQueue(null, newAccessToken);

      return apiClient(originalRequest);
    } catch (refreshError) {
      // Refresh failed — clear auth state (logout)
      useAuthStore.getState().reset();
      processQueue(refreshError, null);
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

// ─── Export ──────────────────────────────────────────────────────────────────

export { apiClient };
export type { AxiosRequestConfig };
