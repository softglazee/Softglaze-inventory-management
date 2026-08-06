/**
 * Tiny fetch wrapper: attaches the access token, auto-refreshes on 401 once,
 * and normalizes { ok, data } / { ok, error } responses.
 */
const BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export type ApiError = { code: string; message: string };

/**
 * "Keep me signed in" decides WHERE the tokens live:
 *   on  → localStorage   — survives closing the browser / the desktop app (7 days,
 *                          the refresh-token lifetime)
 *   off → sessionStorage — cleared the moment the tab or app closes
 *
 * The choice itself is kept in localStorage so a reload knows which store to read.
 * Shared counter PCs should switch it off; a shop's own machine leaves it on.
 */
const REMEMBER_KEY = "il-remember";

export function setRemember(remember: boolean) {
  localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
}
export function getRemember(): boolean {
  return localStorage.getItem(REMEMBER_KEY) !== "0"; // default on
}
function tokenStore(): Storage {
  return getRemember() ? localStorage : sessionStorage;
}
/** Read from either store, so a reload finds the token wherever it was put. */
function readToken(key: string): string | null {
  return sessionStorage.getItem(key) ?? localStorage.getItem(key);
}

let accessToken: string | null = readToken("il-access");
let refreshToken: string | null = readToken("il-refresh");

export function setTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  refreshToken = refresh;
  const store = tokenStore();
  const other = store === localStorage ? sessionStorage : localStorage;
  for (const [key, value] of [["il-access", access], ["il-refresh", refresh]] as const) {
    other.removeItem(key); // never leave a stale copy in the store we're not using
    if (value) store.setItem(key, value);
    else store.removeItem(key);
  }
}

export function getRefreshToken() {
  return refreshToken;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const json = await res.json().catch(() => null);
  if (json?.ok) {
    setTokens(json.data.accessToken, json.data.refreshToken);
    return true;
  }
  setTokens(null, null);
  return false;
}

/**
 * Endpoints where a 401 must NOT trigger a refresh-and-retry: on these it means
 * "these credentials are wrong", and retrying /auth/refresh would loop.
 *
 * Everything else under /auth — /auth/me above all — DOES need the retry. Excluding
 * the whole /auth prefix used to log people out on every reload once the 15-minute
 * access token expired, because the session-restore call to /auth/me 401'd and the
 * still-valid 7-day refresh token was discarded unused.
 */
const NO_REFRESH_RETRY = ["/auth/login", "/auth/register", "/auth/refresh"];

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; isForm?: boolean } = {},
  _retried = false
): Promise<T> {
  const headers: Record<string, string> = {};
  if (!options.isForm) headers["Content-Type"] = "application/json";
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.isForm ? (options.body as FormData) : options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !_retried && !NO_REFRESH_RETRY.some((p) => path.startsWith(p))) {
    const refreshed = await tryRefresh();
    if (refreshed) return api<T>(path, options, true);
  }

  const json = await res.json().catch(() => null);
  if (!json) throw { code: "SERVER_ERROR", message: "Server did not respond correctly" } as ApiError;
  if (!json.ok) throw json.error as ApiError;
  return json.data as T;
}

/** For PDF/Excel downloads later: opens an authorized blob download */
export async function download(path: string, filename: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw { code: "DOWNLOAD_FAILED", message: "Could not download file" } as ApiError;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
