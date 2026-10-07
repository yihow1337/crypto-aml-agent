/** The admin token lives only in this tab's sessionStorage; it is cleared when the tab closes. */
const KEY = 'aml-admin-token';

export function loadAdminToken(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveAdminToken(token: string): void {
  try {
    window.sessionStorage.setItem(KEY, token);
  } catch {
    /* storage unavailable: the token stays in memory for this page view */
  }
}

export function clearAdminToken(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
