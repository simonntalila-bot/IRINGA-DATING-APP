import axios, { AxiosError, type AxiosInstance } from 'axios';
import * as Keychain from 'react-native-keychain';
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../config';
import type { TokenPair } from '../types/api';

const ACCESS_KEY = 'iringa_access_token';
const REFRESH_KEY = 'iringa_refresh_token';

interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  code?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly payload?: ApiErrorBody,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Token storage.
 *
 * Access + refresh tokens live in the device keystore/keychain, never in
 * AsyncStorage. Nothing here is ever printed to the console.
 */
export const secureStore = {
  async save(tokens: TokenPair): Promise<void> {
    await Keychain.setInternetCredentials(ACCESS_KEY, ACCESS_KEY, tokens.accessToken, {
      service: ACCESS_KEY,
    });
    await Keychain.setInternetCredentials(REFRESH_KEY, REFRESH_KEY, tokens.refreshToken, {
      service: REFRESH_KEY,
    });
  },
  async accessToken(): Promise<string | null> {
    const entry = await Keychain.getInternetCredentials(ACCESS_KEY);
    return entry ? entry.password : null;
  },
  async refreshToken(): Promise<string | null> {
    const entry = await Keychain.getInternetCredentials(REFRESH_KEY);
    return entry ? entry.password : null;
  },
  async clear(): Promise<void> {
    await Keychain.resetInternetCredentials(ACCESS_KEY);
    await Keychain.resetInternetCredentials(REFRESH_KEY);
  },
};

type RefreshHandler = () => Promise<string | null>;

let onUnauthorized: RefreshHandler | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export const setUnauthorizedHandler = (handler: RefreshHandler): void => {
  onUnauthorized = handler;
};

const client: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use(async (config) => {
  const token = await secureStore.accessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * A 401 triggers exactly one refresh attempt. Concurrent requests share the
 * same refresh promise so a burst of 401s cannot rotate the token repeatedly
 * (the server would treat that as token reuse and revoke the family).
 */
client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as (typeof client.defaults & { _retry?: boolean }) | undefined;

    if (error.response?.status === 401 && original && !original._retry && onUnauthorized) {
      original._retry = true;
      refreshInFlight =
        refreshInFlight ??
        onUnauthorized().finally(() => {
          refreshInFlight = null;
        });
      const newToken = await refreshInFlight;
      if (newToken) {
        return client.request({
          ...original,
          headers: { ...(original.headers as Record<string, string>), Authorization: `Bearer ${newToken}` },
        });
      }
    }

    return Promise.reject(normaliseError(error));
  },
);

export function normaliseError(error: AxiosError<ApiErrorBody>): ApiError {
  if (!error.response) {
    return new ApiError(0, 'You appear to be offline. Check your connection.', 'NETWORK');
  }
  const body = error.response.data;
  const message = Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? 'Request failed');
  return new ApiError(error.response.status, message, body?.code, body);
}

export const api = {
  get: <T>(url: string, params?: Record<string, unknown>) => client.get<T>(url, { params }).then((r) => r.data),
  post: <T>(url: string, data?: unknown) => client.post<T>(url, data).then((r) => r.data),
  put: <T>(url: string, data?: unknown) => client.put<T>(url, data).then((r) => r.data),
  patch: <T>(url: string, data?: unknown) => client.patch<T>(url, data).then((r) => r.data),
  delete: <T>(url: string, params?: Record<string, unknown>) => client.delete<T>(url, { params }).then((r) => r.data),
  raw: client,
};

/** Upload a file straight to R2 (or the local dev driver) with a signed URL. */
export async function uploadToSignedUrl(
  url: string,
  headers: Record<string, string>,
  file: { uri: string; name: string; type: string },
  onProgress?: (percent: number) => void,
): Promise<void> {
  const formData = new FormData();
  // React Native's FormData accepts this file descriptor shape.
  formData.append('file', file as unknown as Blob);

  await client.put(url, formData, {
    headers: { ...headers, 'Content-Type': 'multipart/form-data' },
    transformRequest: (data) => data,
    onUploadProgress: (event) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    },
  });
}
