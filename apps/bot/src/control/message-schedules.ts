import type { Client, Guild } from "discord.js";
import { parseMessage, parseSendOptions, type MessageBody } from "@tier0/core";
import { prisma } from "@tier0/db";
import type { SystemLabels } from "@tier0/module-system";
import { ok, refuse, type Reply } from "./mod/types.js";
import type { DueTask } from "../runtime/scheduler.js";

/**
 * Messages the dashboard asked to send later, once or on repeat. They are rows
 * of the scheduled work table like any module's, under a kind the bot handles
 * itself, so a restart in between loses nothing.
 */

export const SCHEDULED_SEND = "messages:send";

export type Repeat = "once" | "daily" | "weekly";

const REPEATS: readonly Repeat[] = ["once", "daily", "weekly"];
const STEP_MS: Record<Exclude<Repeat, "once">, number> = { daily: 86_400_000, weekly: 7 * 86_400_000 };

/** A ceiling on what one server can queue, and on how far ahead. */
export const MAX_SCHEDULES = 50;
const MAX_AHEAD_MS = 366 * 86_400_000;
/** Anything sooner is a send, and the scheduler's tick would make it late anyway. */
const MIN_AHEAD_MS = 60_000;

export interface SchedulePayload {
  message: MessageBody;
  /** The send options as they were chosen, read again at send time. */
  options: Record<string, unknown>;
  repeat: Repeat;
  /** What the list calls it: the template's name, or the start of the text. */
  label: string;
  templateId: number | null;
  sender: string;
  /** Why the last run of a repeating send failed, so the list can say so. */
  lastError?: string;
}

export interface ScheduleDto {
  id: number;
  runAt: string;
  repeat: Repeat;
  channelId: string;
  label: string;
  templateId: number | null;
  lastError: string | null;
}

/** The next time a repeating send is due after `now`, stepping on from when it was last due so it keeps its time of day. */
export function nextRun(last: Date, repeat: Repeat, now: Date): Date | null {
  if (repeat === "once") return null;
  const step = STEP_MS[repeat];
  let next = last.getTime() + step;
  if (next <= now.getTime()) next += Math.ceil((now.getTime() - next + 1) / step) * step;
  return new Date(next);
}

type Parsed = { ok: true; value: { runAt: Date; payload: SchedulePayload } } | { ok: false; error: string };

/** Checks a request to schedule a message, as far as it can be checked without Discord. */
export function parseSchedule(input: Record<string, unknown>, now: Date): Parsed {
  const message = parseMessage(input);
  if (!message.ok) return { ok: false, error: message.errors[0]?.message ?? "The message is not valid." };
  const options = parseSendOptions(input);
  if (!options.ok) return { ok: false, error: options.error };

  const runAt = typeof input.runAt === "string" ? new Date(input.runAt) : new Date(Number.NaN);
  if (Number.isNaN(runAt.getTime())) return { ok: false, error: "Pick a date and time to send it." };
  if (runAt.getTime() < now.getTime() + MIN_AHEAD_MS) return { ok: false, error: "Pick a time at least a minute from now, or send it now instead." };
  if (runAt.getTime() > now.getTime() + MAX_AHEAD_MS) return { ok: false, error: "Pick a time within the next year." };

  const repeat = REPEATS.includes(input.repeat as Repeat) ? (input.repeat as Repeat) : "once";
  const templateId = typeof input.templateId === "number" && Number.isInteger(input.templateId) ? input.templateId : null;
  const name = typeof input.label === "string" ? input.label.trim() : "";
  const label = (name || message.value.content.trim() || message.value.embeds[0]?.title.trim() || "Message").replace(/\s+/g, " ").slice(0, 80);
  const sender = typeof input.sender === "string" ? input.sender.trim().slice(0, 80) : "";

  return {
    ok: true,
    value: {
      runAt,
      payload: { message: message.value, options: { ...options.value }, repeat, label, templateId, sender },
    },
  };
}

function dto(row: { id: number; runAt: Date; payload: string }): ScheduleDto | null {
  let payload: Partial<SchedulePayload>;
  try {
    payload = JSON.parse(row.payload) as Partial<SchedulePayload>;
  } catch {
    return null;
  }
  return {
    id: row.id,
    runAt: row.runAt.toISOString(),
    repeat: REPEATS.includes(payload.repeat as Repeat) ? (payload.repeat as Repeat) : "once",
    channelId: typeof payload.options?.channelId === "string" ? payload.options.channelId : "",
    label: typeof payload.label === "string" ? payload.label : "Message",
    templateId: typeof payload.templateId === "number" ? payload.templateId : null,
    lastError: typeof payload.lastError === "string" ? payload.lastError : null,
  };
}

export async function listSchedules(guildId: string): Promise<Reply> {
  const rows = await prisma.scheduledTask.findMany({ where: { guildId, kind: SCHEDULED_SEND }, orderBy: { runAt: "asc" } });
  return ok(rows.map(dto).filter((entry): entry is ScheduleDto => entry !== null));
}

export async function createSchedule(guild: Guild, input: Record<string, unknown>, now = new Date()): Promise<Reply> {
  const parsed = parseSchedule(input, now);
  if (!parsed.ok) return refuse(400, parsed.error);

  const channel = guild.channels.cache.get(String(parsed.value.payload.options.channelId));
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return refuse(404, "Pick a text channel on this server to send it to.");

  if ((await prisma.scheduledTask.count({ where: { guildId: guild.id, kind: SCHEDULED_SEND } })) >= MAX_SCHEDULES) {
    return refuse(409, `A server can have at most ${MAX_SCHEDULES} scheduled messages. Cancel one first.`);
  }
  const row = await prisma.scheduledTask.create({
    data: { guildId: guild.id, kind: SCHEDULED_SEND, runAt: parsed.value.runAt, payload: JSON.stringify(parsed.value.payload) },
  });
  return ok(dto(row));
}

export async function deleteSchedule(guildId: string, id: number): Promise<Reply> {
  const removed = await prisma.scheduledTask.deleteMany({ where: { id, guildId, kind: SCHEDULED_SEND } });
  if (removed.count === 0) return refuse(404, "That scheduled message was not found. It may have been sent already.");
  return ok({ ok: true });
}

type Send = (guild: Guild, payload: Record<string, unknown>, labels: SystemLabels) => Promise<Reply>;

/**
 * Runs one due send. A repeating one is queued again before it is sent, so a
 * failure on one day does not end the series; the failure is kept on the next
 * row for the dashboard to show.
 */
export function scheduledSendRunner(client: Client, send: Send, labelsFor: (guildId: string) => Promise<SystemLabels>) {
  return async (task: DueTask): Promise<void> => {
    const guild = client.guilds.cache.get(task.guildId);
    if (!guild) return;
    const payload = task.payload as Partial<SchedulePayload>;
    if (!payload.message || !payload.options) return;

    const repeat = REPEATS.includes(payload.repeat as Repeat) ? (payload.repeat as Repeat) : "once";
    const next = nextRun(task.runAt, repeat, new Date());
    const nextRow = next
      ? await prisma.scheduledTask.create({
          data: { guildId: task.guildId, kind: SCHEDULED_SEND, runAt: next, payload: JSON.stringify({ ...payload, lastError: undefined }) },
        })
      : null;

    const reply = await send(guild, { ...payload.message, ...payload.options, sender: payload.sender, templateId: payload.templateId }, await labelsFor(guild.id));
    if (reply.status < 400) return;
    const error = (reply.body as { error?: string } | undefined)?.error ?? "Discord refused the message.";
    console.error(`Scheduled message "${payload.label ?? ""}" in guild ${task.guildId} was not sent: ${error}`);
    if (nextRow) {
      await prisma.scheduledTask
        .update({ where: { id: nextRow.id }, data: { payload: JSON.stringify({ ...payload, lastError: error }) } })
        .catch(() => undefined);
    }
  };
}
