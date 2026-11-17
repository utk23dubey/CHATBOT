import { TOKEN_STORAGE_KEY, USER_STORAGE_KEY } from './constants';

export interface AuthUser {
  id: string | number;
  name: string;
  email: string;
  role: string;
  mobileNumber: string;
  country: string;
}

export interface AuthState {
  token: string;
  user: AuthUser;
}

const PLACEHOLDER_USER: AuthUser = {
  id: '',
  name: 'User',
  email: '',
  role: 'user',
  mobileNumber: '',
  country: '',
};

export function isAuthUser(value: unknown): value is AuthUser {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (typeof candidate.id === 'string' || typeof candidate.id === 'number') &&
    typeof candidate.name === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.role === 'string' &&
    typeof candidate.mobileNumber === 'string' &&
    typeof candidate.country === 'string'
  );
}

/** Read the current JWT from localStorage. Returns null when it is absent or unusable. */
export function getAuthToken(): string | null {
  try {
    const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    return token && token.trim() ? token : null;
  } catch {
    // localStorage can be unavailable (privacy modes, disabled storage).
    return null;
  }
}

/**
 * Restore a session on app load. The JWT is the source of truth; user details
 * are only used for display, so a missing/corrupt user record falls back to a
 * placeholder instead of discarding an otherwise valid token.
 */
export function readAuthState(): AuthState | null {
  const token = getAuthToken();
  if (!token) return null;

  let user: AuthUser = PLACEHOLDER_USER;
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(USER_STORAGE_KEY) ?? 'null',
    );
    if (isAuthUser(stored)) user = stored;
  } catch {
    // Ignore malformed stored user data.
  }

  return { token, user };
}

export function persistAuth(state: AuthState): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, state.token);
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(state.user));
  } catch {
    // Keep the in-memory session working even if storage writes fail.
  }
}

export function clearAuth(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // Nothing to do if storage is unavailable.
  }
}
