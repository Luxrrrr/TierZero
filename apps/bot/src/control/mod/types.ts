import type { Client, Guild } from "discord.js";
import type { SystemLabels } from "@tier0/module-system";

export interface Reply {
  status: number;
  body: unknown;
  /**
   * A reply that is not JSON, such as a CSV download. When set it is sent in
   * place of `body`; a filename turns it into an attachment.
   */
  raw?: { contentType: string; text: string; filename?: string };
}

/** What every mod handler is given. */
export interface ModCtx {
  client: Client;
  guild: Guild;
  /** The owner's short pieces of text, for the few the bot writes to Discord itself. The defaults apply without them. */
  labels?: SystemLabels;
}

export const ok = (body: unknown): Reply => ({ status: 200, body });
export const refuse = (status: 400 | 403 | 404 | 409 | 429, error: string): Reply => ({ status, body: { error } });
export const forbidden = (what: string): Reply => refuse(403, `You do not have permission to ${what}.`);
export const notFound = (what: string): Reply => refuse(404, `${what} was not found.`);

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

/** Reads `page` and `pageSize` from a query string, keeping both inside sane bounds. */
export function pageOf(query: URLSearchParams): { page: number; pageSize: number } {
  const page = Math.max(1, Math.trunc(Number(query.get("page"))) || 1);
  const asked = Math.trunc(Number(query.get("pageSize"))) || PAGE_SIZE_DEFAULT;
  return { page, pageSize: Math.min(PAGE_SIZE_MAX, Math.max(1, asked)) };
}

/** Response headers for a raw reply. The file name is reduced to safe characters so it cannot break out of the header. */
export function rawHeaders(raw: NonNullable<Reply["raw"]>): Record<string, string> {
  const headers: Record<string, string> = { "content-type": raw.contentType, "cache-control": "no-store" };
  if (raw.filename) {
    headers["content-disposition"] = `attachment; filename="${raw.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`;
  }
  return headers;
}
