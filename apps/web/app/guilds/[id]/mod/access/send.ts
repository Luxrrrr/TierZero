export interface Outcome {
  ok: boolean;
  error?: string;
}

/**
 * Sends one write and reduces every failure, including a dead network, to a
 * sentence the page can show. The server's own wording wins when it sent any.
 */
export async function send(url: string, method: "PUT" | "DELETE", body?: unknown): Promise<Outcome> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: payload?.error ?? `The server answered ${response.status}.` };
  } catch {
    return { ok: false, error: "The dashboard could not be reached. Check your connection and try again." };
  }
}
