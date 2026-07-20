export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
};

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const hasBody = options.body !== undefined && options.body !== null;

  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  let envelope: Envelope<T> | null = null;
  try {
    envelope = await res.json();
  } catch {
    // non-JSON response (e.g. placeholder/health endpoints during early phases) — fall through
  }

  if (!res.ok || envelope?.ok === false) {
    const code = envelope?.error?.code ?? "unknown_error";
    const message = envelope?.error?.message ?? `Request failed with status ${res.status}`;
    throw new ApiError(res.status, code, message);
  }

  return (envelope?.data ?? envelope) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
