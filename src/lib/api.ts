// HTTP client for the self-hosted Vidura API. Sends the better-auth session
// cookie with every request (credentials: include) and speaks JSON.

// The app is served from two domains. Auth cookies are SameSite=Lax, so each
// frontend must talk to an API host on its own registrable domain: the
// prabhavalabs.com frontend uses the vidura-api.prabhavalabs.com proxy, every
// other host uses the build-time VITE_API_URL.
function resolveApiBaseUrl(): string {
  if (
    typeof window !== "undefined" &&
    window.location.hostname.endsWith("prabhavalabs.com")
  ) {
    return "https://vidura-api.prabhavalabs.com";
  }
  return import.meta.env.VITE_API_URL ?? "http://localhost:8787";
}

export const apiBaseUrl = resolveApiBaseUrl().replace(/\/$/, "");

export const isApiConfigured = Boolean(import.meta.env.VITE_API_URL) ||
  import.meta.env.DEV;

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null) as
      | { error?: string }
      | null;
    throw new ApiError(
      detail?.error ?? `Request failed (${response.status})`,
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export type SseHandlers = {
  onEvent: (data: Record<string, unknown>) => void;
};

// Streams a POST SSE endpoint (chat). EventSource only does GET, so we read
// the response body manually.
export async function streamPost(
  path: string,
  body: unknown,
  onEvent: (data: Record<string, unknown>) => void,
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => null) as
      | { error?: string }
      | null;
    throw new Error(detail?.error ?? "The service is unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        onEvent(JSON.parse(payload));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
