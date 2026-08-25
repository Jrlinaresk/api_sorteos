import type { AdminSession, ApiErrorBody } from './types';
import { withCrossTabLock } from './cross-tab-lock';

const API_ROOT = '/api/v1';
export const SESSION_EXPIRED_EVENT = 'sorteos:admin-session-expired';
export const ADMIN_LOGOUT_PENDING_KEY = 'sorteos:admin-logout-pending:v1';
let accessToken: string | null = null;
let refreshInFlight: Promise<AdminSession> | null = null;

function hasPendingLogout(): boolean {
  try {
    return localStorage.getItem(ADMIN_LOGOUT_PENDING_KEY) === 'pending';
  } catch {
    return false;
  }
}

function markPendingLogout(): void {
  try {
    localStorage.setItem(ADMIN_LOGOUT_PENDING_KEY, 'pending');
  } catch {
    // La revocación se intenta igualmente en esta pestaña.
  }
}

function clearPendingLogout(): void {
  try {
    localStorage.removeItem(ADMIN_LOGOUT_PENDING_KEY);
  } catch {
    // Repetir un logout idempotente al reiniciar no causa daño.
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly correlationId?: string;
  readonly meta?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    const message = Array.isArray(body.message)
      ? body.message.join(' · ')
      : body.message || `La solicitud falló (${status})`;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.correlationId = body.correlationId;
    this.meta = body.meta;
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  skipAuthRefresh?: boolean;
}

function urlFor(path: string, query?: ApiRequestOptions['query']): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${API_ROOT}${normalized}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = { message: response.statusText };
  }
  return new ApiError(response.status, body);
}

async function execute<T>(
  path: string,
  options: ApiRequestOptions = {},
  retry = true,
): Promise<T> {
  const { body, query, skipAuthRefresh, headers, ...requestOptions } = options;
  const requestHeaders = new Headers(headers);
  if (path.startsWith('/admin/session')) {
    requestHeaders.set('X-Admin-Session', 'browser');
  }
  if (accessToken) requestHeaders.set('Authorization', `Bearer ${accessToken}`);
  let requestBody: BodyInit | undefined;
  if (body instanceof FormData) {
    requestBody = body;
  } else if (body !== undefined) {
    requestHeaders.set('Content-Type', 'application/json');
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(urlFor(path, query), {
    ...requestOptions,
    cache: 'no-store',
    headers: requestHeaders,
    body: requestBody,
    credentials: 'include',
  });

  if (
    response.status === 401 &&
    retry &&
    !skipAuthRefresh &&
    !path.startsWith('/admin/session/')
  ) {
    try {
      await refreshSession();
      return execute<T>(path, options, false);
    } catch {
      accessToken = null;
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
  }
  if (!response.ok) throw await parseError(response);
  return parseResponse<T>(response);
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export async function loginSession(
  phone: string,
  password: string,
): Promise<AdminSession> {
  const session = await execute<AdminSession>('/admin/session/login', {
    method: 'POST',
    body: { phone, password },
    skipAuthRefresh: true,
  });
  setAccessToken(session.accessToken);
  clearPendingLogout();
  return session;
}

export async function refreshSession(): Promise<AdminSession> {
  if (!refreshInFlight) {
    refreshInFlight = withCrossTabLock('admin-session-mutation', async () => {
      if (hasPendingLogout()) {
        await execute<void>('/admin/session/logout', {
          method: 'POST',
          skipAuthRefresh: true,
        });
        clearPendingLogout();
        setAccessToken(null);
        throw new ApiError(401, {
          message: 'La sesión pendiente de cierre fue revocada',
        });
      }
      const session = await execute<AdminSession>('/admin/session/refresh', {
        method: 'POST',
        skipAuthRefresh: true,
      });
      if (hasPendingLogout()) {
        await execute<void>('/admin/session/logout', {
          method: 'POST',
          skipAuthRefresh: true,
        });
        clearPendingLogout();
        setAccessToken(null);
        throw new ApiError(401, {
          message: 'La sesión se cerró durante la rotación',
        });
      }
      setAccessToken(session.accessToken);
      return session;
    }).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function logoutSession(): Promise<void> {
  markPendingLogout();
  try {
    await withCrossTabLock('admin-session-mutation', () =>
      execute<void>('/admin/session/logout', {
        method: 'POST',
        skipAuthRefresh: true,
      }),
    );
    clearPendingLogout();
  } finally {
    setAccessToken(null);
  }
}

export const api = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    execute<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    execute<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    execute<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    execute<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: ApiRequestOptions) =>
    execute<T>(path, { ...options, method: 'DELETE' }),
};

export async function downloadFile(
  path: string,
  filename: string,
  query?: ApiRequestOptions['query'],
): Promise<void> {
  const request = () =>
    fetch(urlFor(path, query), {
      cache: 'no-store',
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : undefined,
      credentials: 'include',
    });
  let response = await request();
  if (response.status === 401) {
    try {
      await refreshSession();
      response = await request();
    } catch {
      setAccessToken(null);
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
  }
  if (!response.ok) throw await parseError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
