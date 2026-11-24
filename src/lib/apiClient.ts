import { auth } from './firebase';

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getFreshAuthToken(forceRefresh = false): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError('Anda belum masuk dengan akun Google.', 401, 'NOT_SIGNED_IN');
  }
  try {
    return await user.getIdToken(forceRefresh);
  } catch (err) {
    if (forceRefresh) {
      // Fallback to cached token if forced refresh fails on weak network
      return await user.getIdToken(false);
    }
    throw err;
  }
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit & { forceRefreshToken?: boolean } = {}
): Promise<T> {
  const { forceRefreshToken = false, headers, ...rest } = options;
  const token = await getFreshAuthToken(forceRefreshToken);

  const response = await fetch(url, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(headers || {}),
    },
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : `Server mengembalikan status ${response.status}.`;
    const code = typeof data.code === 'string' ? data.code : undefined;
    throw new ApiError(msg, response.status, code);
  }

  return data as T;
}

export async function checkServerReachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}
