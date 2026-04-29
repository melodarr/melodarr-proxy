export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const contentType = res.headers.get("content-type") || "";
  const body = await res.text();
  const isJson = contentType.includes("application/json");
  const parsed: any = isJson && body ? JSON.parse(body) : null;

  if (!res.ok) {
    const message =
      parsed?.error ||
      parsed?.message ||
      `Request failed for ${url} (${res.status} ${res.statusText || "HTTP error"})`;
    const error = new Error(message) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  if (!isJson) {
    throw new Error(`Expected JSON from ${url}, got ${contentType || "unknown content type"} (${res.status})`);
  }

  return parsed as T;
}

export const fetcher = (url: string) => fetchJson<any>(url);
