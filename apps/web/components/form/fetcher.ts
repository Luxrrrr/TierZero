/**
 * The dashboard's own API routes answer with JSON on success and with
 * `{ error }` on failure, so a failed request has to become a rejection rather
 * than a body the pickers would try to render as a list.
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request to ${url} failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}
