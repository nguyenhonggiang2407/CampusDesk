let csrfToken: string | null = null;
export function setCsrf(token: string | null) { csrfToken = token; }
export class RequestError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (csrfToken && options.method && !['GET', 'HEAD'].includes(options.method)) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(data.error || 'The service is unavailable. Try again.', response.status);
  return data as T;
}
