import { prisma } from "@tier0/db";

/**
 * Which channels hold an open ticket, per server, kept in memory. Every
 * message in a server goes past the ticket handlers, and without this each one
 * would cost a query to learn that it is not in a ticket. The module's own
 * opens, closes and transfers keep it current; the list is also read again
 * after a while in case a row changed some other way.
 */

export interface OpenTicketEntry {
  id: number;
  openerId: string;
  typeId: string | null;
  panelId: string | null;
}

const REFRESH_MS = 10 * 60_000;

interface GuildEntry {
  loadedAt: number;
  channels: Map<string, OpenTicketEntry>;
}

type Change = { channelId: string; ticket: OpenTicketEntry | null };

const guilds = new Map<string, GuildEntry>();
const loading = new Map<string, Promise<GuildEntry>>();
/**
 * Opens and closes that happened while a server's list was being read. The
 * read may have started before them, so they are applied on top of it once
 * it is back rather than lost.
 */
const pending = new Map<string, Change[]>();

function apply(channels: Map<string, OpenTicketEntry>, change: Change): void {
  if (change.ticket) channels.set(change.channelId, change.ticket);
  else channels.delete(change.channelId);
}

async function load(guildId: string): Promise<GuildEntry> {
  pending.set(guildId, []);
  const rows = await prisma.ticket.findMany({
    where: { guildId, status: "open" },
    select: { id: true, channelId: true, openerId: true, typeId: true, panelId: true },
  });
  const entry: GuildEntry = {
    loadedAt: Date.now(),
    channels: new Map(rows.map((row) => [row.channelId, { id: row.id, openerId: row.openerId, typeId: row.typeId, panelId: row.panelId }])),
  };
  for (const change of pending.get(guildId) ?? []) apply(entry.channels, change);
  pending.delete(guildId);
  guilds.set(guildId, entry);
  return entry;
}

async function entryFor(guildId: string): Promise<GuildEntry> {
  const known = guilds.get(guildId);
  if (known && Date.now() - known.loadedAt < REFRESH_MS) return known;
  const inFlight = loading.get(guildId);
  if (inFlight) return inFlight;
  const next = load(guildId).finally(() => {
    loading.delete(guildId);
    pending.delete(guildId);
  });
  loading.set(guildId, next);
  return next;
}

/** The open ticket in this channel, if there is one. */
export async function openTicketIn(guildId: string, channelId: string): Promise<OpenTicketEntry | undefined> {
  return (await entryFor(guildId)).channels.get(channelId);
}

function change(guildId: string, update: Change): void {
  const known = guilds.get(guildId);
  if (known) apply(known.channels, update);
  pending.get(guildId)?.push(update);
}

export function rememberOpenTicket(guildId: string, channelId: string, ticket: OpenTicketEntry): void {
  change(guildId, { channelId, ticket });
}

export function forgetOpenTicket(guildId: string, channelId: string): void {
  change(guildId, { channelId, ticket: null });
}

/** Drops what is known, so the next lookup reads the table. For tests, and for a server whose tickets changed wholesale. */
export function forgetOpenTickets(guildId?: string): void {
  if (guildId === undefined) guilds.clear();
  else guilds.delete(guildId);
}
