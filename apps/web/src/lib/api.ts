/**
 * Tiny fetch wrapper: attaches the access token, auto-refreshes on 401 once,
 * and normalizes { ok, data } / { ok, error } responses.
 */
const BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export type ApiError = { code: string; message: string };

let accessToken: string | null = localStorage.getItem("il-access");
let refreshToken: string | null = localStorage.getItem("il-refresh");

export function setTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  refreshToken = refresh;
  if (access) localStorage.setItem("il-access", access);
  else localStorage.removeItem("il-access");
  if (refresh) localStorage.setItem("il-refresh", refresh);
  else localStorage.removeItem("il-refresh");
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

  if (res.status === 401 && !_retried && !path.startsWith("/auth/")) {
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
