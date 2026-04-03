'use client';

const TOKEN_KEY = 'platerank_token';
const USER_KEY = 'platerank_user';

export function setAuth(token: string, user: unknown): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser<T>(): T | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function updateStoredUser(partial: Record<string, unknown>): void {
  const currentRaw = localStorage.getItem(USER_KEY);
  if (!currentRaw) {
    return;
  }

  try {
    const current = JSON.parse(currentRaw) as Record<string, unknown>;
    const updated = { ...current, ...partial };
    localStorage.setItem(USER_KEY, JSON.stringify(updated));
  } catch {
    // no-op
  }
}
