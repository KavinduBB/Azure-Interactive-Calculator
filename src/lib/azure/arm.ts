import "server-only";

const ARM = "https://management.azure.com";

export class ArmError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export async function armFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${ARM}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let message = `Azure returned ${res.status}`;
    let code: string | undefined;
    try {
      const body = await res.json();
      const detail = body?.error?.details?.map((d: { message?: string }) => d.message).filter(Boolean).join(" ");
      message = detail || body?.error?.message || message;
      code = body?.error?.code;
    } catch {
      /* body was not JSON */
    }
    throw new ArmError(message, res.status, code);
  }
  return (await res.json()) as T;
}

/** Follows `nextLink` pages for list endpoints that return `{ value, nextLink }`. */
export async function armList<T>(token: string, path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = path;
  let guard = 0;
  while (next && guard++ < 50) {
    const page: { value: T[]; nextLink?: string } = await armFetch(token, next);
    out.push(...page.value);
    next = page.nextLink;
  }
  return out;
}
