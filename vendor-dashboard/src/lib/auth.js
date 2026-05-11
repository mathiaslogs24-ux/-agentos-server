const KEY = 'vendor_token';

export const getToken   = () => localStorage.getItem(KEY);
export const setToken   = (t) => localStorage.setItem(KEY, t);
export const clearToken = () => localStorage.removeItem(KEY);

// Decode JWT payload without a library (display only — not for auth decisions)
export function decodeToken(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}
