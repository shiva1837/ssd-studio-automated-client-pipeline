const TOKEN_KEY = 'ssd_studio_token';

/**
 * JWT Token management utilities.
 * Stores token in localStorage for persistence across sessions.
 */

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

/**
 * Decode a JWT token payload without verification.
 * Useful for extracting user info client-side.
 */
export function decodeToken<T = Record<string, any>>(token: string): T | null {
  try {
    const base64Payload = token.split('.')[1];
    const payload = atob(base64Payload);
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

/**
 * Check if a token is expired.
 */
export function isTokenExpired(token: string): boolean {
  const decoded = decodeToken<{ exp: number }>(token);
  if (!decoded?.exp) return true;
  return Date.now() >= decoded.exp * 1000;
}
