"use client";

// Browser-side calls to Contrail's API routes. Every JSON route answers with
// {ok: true, data} or {ok: false, error}; this unwraps it or throws the error text.

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Can't reach Contrail. Check your connection.", 0);
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null;
  // An abort while the body was streaming must stay an abort, not turn into an error banner.
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!res.ok || !body?.ok) throw new ApiError(body?.error ?? `Request failed (HTTP ${res.status}).`, res.status);
  return body.data as T;
}

export function post<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(payload), signal });
}

/** Read an NDJSON response line by line. */
export async function readNdjson(res: Response, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line));
        } catch {
          /* skip a malformed line */
        }
      }
    }
  }
}
