const CSRF_STORAGE_KEY = "melodarr_proxy_csrf";

let memoryToken: string | null = null;

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.sessionStorage);
}

export function rememberCsrfToken(payload: unknown) {
  const token = typeof payload === "object" && payload !== null && "csrfToken" in payload
    ? String((payload as { csrfToken?: unknown }).csrfToken || "")
    : "";

  if (!token) return;

  memoryToken = token;
  if (canUseStorage()) {
    window.sessionStorage.setItem(CSRF_STORAGE_KEY, token);
  }
}

export function clearCsrfToken() {
  memoryToken = null;
  if (canUseStorage()) {
    window.sessionStorage.removeItem(CSRF_STORAGE_KEY);
  }
}

export function getCsrfToken() {
  if (memoryToken) return memoryToken;
  if (!canUseStorage()) return null;
  memoryToken = window.sessionStorage.getItem(CSRF_STORAGE_KEY);
  return memoryToken;
}

export function withCsrfToken(init?: RequestInit): RequestInit | undefined {
  const method = String(init?.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return init;

  const token = getCsrfToken();
  if (!token) return init;

  const headers = new Headers(init?.headers);
  headers.set("X-CSRF-Token", token);

  return {
    ...init,
    headers,
  };
}
