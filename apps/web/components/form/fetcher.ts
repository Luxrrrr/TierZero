import { readFailure } from "../../lib/bot-errors";

/** A failed request, carrying the status so a picker can tell "not there" from "broken". */
export class FetchError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

/**
 * The dashboard's own API routes answer with JSON on success and with
 * `{ error }` on failure, so a failed request has to become a rejection rather
 * than a body the pickers would try to render as a list.
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const failure = await readFailure(response);
    throw new FetchError(response.status, failure.message);
  }
  return (await response.json()) as T;
}
