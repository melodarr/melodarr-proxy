/**
 * Resolves the base URL for the melodarr-proxy API.
 *
 * Resolution order:
 *   1. Explicit env override (NEXT_PUBLIC_PROXY_BASE_URL)
 *   2. Same-origin in the browser (window.location.origin)
 *   3. Server-side dev fallback (http://localhost:3055)
 */
export function resolveProxyBaseUrl(): string {
  const override = process.env.NEXT_PUBLIC_PROXY_BASE_URL;
  if (override) return override.replace(/\/+$/, "");

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost:3055";
}

function joinBaseAndPath(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

/**
 * Fetches a path against the resolved proxy base, with optional fallback.
 *
 * - Tries the primary base first.
 * - If the response is not OK or the request throws, and NEXT_PUBLIC_PROXY_FALLBACK
 *   is configured, retries against the fallback.
 * - Throws "Proxy unreachable" if both attempts fail (or only primary is configured
 *   and it failed).
 *
 * Absolute URLs are passed through untouched.
 */
export async function fetchWithFallback(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const primaryBase = resolveProxyBaseUrl();
  const primaryUrl = joinBaseAndPath(primaryBase, path);

  let primaryError: unknown;
  try {
    const res = await fetch(primaryUrl, init);
    if (res.ok) return res;
    primaryError = new Error(`Primary returned ${res.status} ${res.statusText}`);
  } catch (err) {
    primaryError = err;
  }

  const fallbackBase = process.env.NEXT_PUBLIC_PROXY_FALLBACK;
  if (fallbackBase) {
    const fallbackUrl = joinBaseAndPath(fallbackBase.replace(/\/+$/, ""), path);
    try {
      return await fetch(fallbackUrl, init);
    } catch (err) {
      throw new Error(
        `Proxy unreachable (primary: ${primaryUrl} — ${describeError(primaryError)}; fallback: ${fallbackUrl} — ${describeError(err)})`
      );
    }
  }

  throw new Error(`Proxy unreachable (${primaryUrl} — ${describeError(primaryError)})`);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}
