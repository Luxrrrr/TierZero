import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type Guild,
  type Message,
  type NewsChannel,
  type TextChannel,
  type Webhook,
} from "discord.js";
import {
  MESSAGE_LIMITS,
  applyVariablesToMessage,
  cleanName,
  discordTimestamp,
  parseMessage,
  parseSendOptions,
  type MessageBody,
  type VariableValues,
} from "@tier0/core";
import { prisma } from "@tier0/db";
import { LABEL_DEFAULTS, type SystemLabels } from "@tier0/module-system";
import { saveInteractions } from "../runtime/message-components.js";
import { firstEmptyLimitedMenu, namesOf, toDiscordPayload } from "./message-payload.js";
import { ok, refuse, type Reply } from "./mod/types.js";
import { createSchedule, deleteSchedule, listSchedules } from "./message-schedules.js";

export interface MessagesRequest {
  guild: Guild;
  method: string;
  /** The path after `/guilds/:id/messages/`, split on slashes. */
  segments: string[];
  body: unknown;
  /** The owner's short pieces of text; the defaults apply without them. */
  labels?: SystemLabels;
}

/** Enough for any real server, and a ceiling on what one install can be made to store. */
const MAX_FOLDERS = 50;
const MAX_TEMPLATES = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const idOf = (value: string | undefined): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

interface TemplateRow {
  id: number;
  folderId: number | null;
  name: string;
  content: string;
  embeds: string;
  buttons: string;
  selects: string;
  reactions: string;
  inTickets: boolean;
  updatedAt: Date;
  lastSentAt: Date | null;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return [];
  }
};

/**
 * What a row holds, read back through the same rules a save goes through. A
 * damaged column reads as empty rather than failing the whole list. The
 * placeholder text only lets an embed-only message through the "something to
 * send" check, and is never kept.
 */
export function storedBody(row: Pick<TemplateRow, "content" | "embeds" | "buttons" | "selects" | "reactions">): MessageBody {
  const parsed = parseMessage({
    content: row.content === "" ? "-" : row.content,
    embeds: parseJson(row.embeds),
    buttons: parseJson(row.buttons),
    selects: parseJson(row.selects),
    reactions: parseJson(row.reactions),
  });
  if (!parsed.ok) return { content: row.content, embeds: [], buttons: [], selects: [], reactions: [] };
  return { ...parsed.value, content: row.content };
}

const templateDto = (row: TemplateRow) => ({
  id: row.id,
  folderId: row.folderId,
  name: row.name,
  ...storedBody(row),
  inTickets: row.inTickets,
  updatedAt: row.updatedAt.toISOString(),
  lastSentAt: row.lastSentAt?.toISOString() ?? null,
});

/** Routes one request under `/guilds/:id/messages/`. Returns null for a path that matches nothing. */
export async function handleMessages(request: MessagesRequest): Promise<Reply | null> {
  const { guild, method, segments, body, labels = LABEL_DEFAULTS } = request;
  const [area, rawId] = segments;
  const payload = isRecord(body) ? body : {};

  if (method === "GET" && area === undefined) return listAll(guild.id);

  if (method === "POST" && area === "folders" && rawId === undefined) return createFolder(guild.id, payload.name);
  if (area === "folders" && rawId !== undefined) {
    const id = idOf(rawId);
    if (id === null) return refuse(400, "That folder id is not valid.");
    if (method === "PATCH") return renameFolder(guild.id, id, payload.name);
    if (method === "DELETE") return deleteFolder(guild.id, id);
  }

  if (method === "POST" && area === "templates" && rawId === undefined) return createTemplate(guild.id, payload);
  if (area === "templates" && rawId !== undefined) {
    const id = idOf(rawId);
    if (id === null) return refuse(400, "That template id is not valid.");
    if (method === "PATCH") return updateTemplate(guild.id, id, payload);
    if (method === "DELETE") return deleteTemplate(guild.id, id);
  }

  if (method === "GET" && area === "emojis" && rawId === undefined) return listEmojis(guild);

  if (method === "POST" && area === "send" && rawId === undefined) return sendMessage(guild, payload, labels);
  if (method === "POST" && area === "edit" && rawId === undefined) return editSentMessage(guild, payload, labels);

  if (method === "GET" && area === "templates" && rawId !== undefined && segments[2] === "sends" && segments.length === 3) {
    const id = idOf(rawId);
    if (id === null) return refuse(400, "That template id is not valid.");
    return listSends(guild.id, id);
  }
  if (area === "sends") {
    if (method === "GET" && rawId === undefined) return listSends(guild.id, null);
    if (method === "DELETE" && rawId !== undefined) {
      const id = idOf(rawId);
      if (id === null) return refuse(400, "That sent message id is not valid.");
      return forgetSend(guild.id, id);
    }
  }

  if (area === "schedules") {
    if (method === "GET" && rawId === undefined) return listSchedules(guild.id);
    if (method === "POST" && rawId === undefined) return createSchedule(guild, payload);
    if (method === "DELETE" && rawId !== undefined) {
      const id = idOf(rawId);
      if (id === null) return refuse(400, "That scheduled message id is not valid.");
      return deleteSchedule(guild.id, id);
    }
  }

  return null;
}

async function listAll(guildId: string): Promise<Reply> {
  const [folders, templates] = await Promise.all([
    prisma.messageFolder.findMany({ where: { guildId }, orderBy: { name: "asc" } }),
    prisma.messageTemplate.findMany({ where: { guildId }, orderBy: { name: "asc" } }),
  ]);
  return ok({
    folders: folders.map((folder) => ({ id: folder.id, name: folder.name })),
    templates: templates.map(templateDto),
  });
}

async function createFolder(guildId: string, rawName: unknown): Promise<Reply> {
  const name = cleanName(rawName, MESSAGE_LIMITS.folderName, "The folder name");
  if (!name.ok) return refuse(400, name.error);

  if ((await prisma.messageFolder.count({ where: { guildId } })) >= MAX_FOLDERS) {
    return refuse(409, `A server can have at most ${MAX_FOLDERS} folders.`);
  }
  if (await folderNameTaken(guildId, name.value)) {
    return refuse(409, "There is already a folder with that name.");
  }
  const folder = await prisma.messageFolder.create({ data: { guildId, name: name.value } });
  return ok({ id: folder.id, name: folder.name });
}

async function renameFolder(guildId: string, id: number, rawName: unknown): Promise<Reply> {
  const name = cleanName(rawName, MESSAGE_LIMITS.folderName, "The folder name");
  if (!name.ok) return refuse(400, name.error);

  const folder = await prisma.messageFolder.findFirst({ where: { id, guildId } });
  if (!folder) return refuse(404, "That folder was not found.");
  if (await folderNameTaken(guildId, name.value, id)) {
    return refuse(409, "There is already a folder with that name.");
  }
  const updated = await prisma.messageFolder.update({ where: { id }, data: { name: name.value } });
  return ok({ id: updated.id, name: updated.name });
}

/** The templates inside go back to the main list rather than being deleted with it. */
async function deleteFolder(guildId: string, id: number): Promise<Reply> {
  const folder = await prisma.messageFolder.findFirst({ where: { id, guildId } });
  if (!folder) return refuse(404, "That folder was not found.");
  await prisma.messageFolder.delete({ where: { id } });
  return ok({ ok: true });
}

async function folderNameTaken(guildId: string, name: string, exceptId?: number): Promise<boolean> {
  const folders = await prisma.messageFolder.findMany({ where: { guildId } });
  return folders.some((folder) => folder.id !== exceptId && folder.name.toLowerCase() === name.toLowerCase());
}

/** Two templates in one folder cannot share a name, ignoring case. Folders are separate namespaces. */
async function templateNameTaken(
  guildId: string,
  folderId: number | null,
  name: string,
  exceptId?: number,
): Promise<boolean> {
  const siblings = await prisma.messageTemplate.findMany({ where: { guildId, folderId } });
  return siblings.some((row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase());
}

/** A folder id from the dashboard, which must be this server's own or null. */
async function resolveFolder(guildId: string, value: unknown): Promise<{ ok: true; id: number | null } | Reply> {
  if (value === undefined || value === null) return { ok: true, id: null };
  const id = typeof value === "number" ? value : Number.NaN;
  if (!Number.isInteger(id)) return refuse(400, "That folder is not valid.");
  const folder = await prisma.messageFolder.findFirst({ where: { id, guildId } });
  return folder ? { ok: true, id } : refuse(404, "That folder was not found.");
}

const isReply = (value: { ok: true; id: number | null } | Reply): value is Reply => "status" in value;

/** The "available in tickets" flag of a save. Left out it is undefined, so an update keeps what the template has. */
function readInTickets(payload: Record<string, unknown>): { ok: true; value: boolean | undefined } | { ok: false; error: string } {
  const value = payload.inTickets;
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "boolean") return { ok: false, error: "Available in tickets must be on or off." };
  return { ok: true, value };
}

function messageErrors(errors: { path: string; message: string }[]): Reply {
  return { status: 400, body: { error: errors[0]?.message ?? "The message is not valid.", errors } };
}

async function createTemplate(guildId: string, payload: Record<string, unknown>): Promise<Reply> {
  const name = cleanName(payload.name, MESSAGE_LIMITS.templateName, "The template name");
  if (!name.ok) return refuse(400, name.error);

  const message = parseMessage(payload);
  if (!message.ok) return messageErrors(message.errors);

  const flag = readInTickets(payload);
  if (!flag.ok) return refuse(400, flag.error);

  const folder = await resolveFolder(guildId, payload.folderId);
  if (isReply(folder)) return folder;

  if ((await prisma.messageTemplate.count({ where: { guildId } })) >= MAX_TEMPLATES) {
    return refuse(409, `A server can keep at most ${MAX_TEMPLATES} templates.`);
  }
  if (await templateNameTaken(guildId, folder.id, name.value)) {
    return refuse(409, "There is already a template with that name in this folder.");
  }

  const row = await prisma.messageTemplate.create({
    data: {
      guildId,
      folderId: folder.id,
      name: name.value,
      content: message.value.content,
      embeds: JSON.stringify(message.value.embeds),
      buttons: JSON.stringify(message.value.buttons),
      selects: JSON.stringify(message.value.selects),
      reactions: JSON.stringify(message.value.reactions),
      inTickets: flag.value ?? false,
    },
  });
  return ok(templateDto(row));
}

async function updateTemplate(guildId: string, id: number, payload: Record<string, unknown>): Promise<Reply> {
  const row = await prisma.messageTemplate.findFirst({ where: { id, guildId } });
  if (!row) return refuse(404, "That template was not found.");

  let name = row.name;
  if (payload.name !== undefined) {
    const cleaned = cleanName(payload.name, MESSAGE_LIMITS.templateName, "The template name");
    if (!cleaned.ok) return refuse(400, cleaned.error);
    name = cleaned.value;
  }

  const flag = readInTickets(payload);
  if (!flag.ok) return refuse(400, flag.error);

  let folderId = row.folderId;
  if ("folderId" in payload) {
    const folder = await resolveFolder(guildId, payload.folderId);
    if (isReply(folder)) return folder;
    folderId = folder.id;
  }

  let content = row.content;
  let embeds = row.embeds;
  let buttons = row.buttons;
  let selects = row.selects;
  let reactions = row.reactions;
  if (["content", "embeds", "buttons", "selects", "reactions"].some((key) => key in payload)) {
    const current = storedBody(row);
    const message = parseMessage({
      content: "content" in payload ? payload.content : current.content,
      embeds: "embeds" in payload ? payload.embeds : current.embeds,
      buttons: "buttons" in payload ? payload.buttons : current.buttons,
      selects: "selects" in payload ? payload.selects : current.selects,
      reactions: "reactions" in payload ? payload.reactions : current.reactions,
    });
    if (!message.ok) return messageErrors(message.errors);
    content = message.value.content;
    embeds = JSON.stringify(message.value.embeds);
    buttons = JSON.stringify(message.value.buttons);
    selects = JSON.stringify(message.value.selects);
    reactions = JSON.stringify(message.value.reactions);
  }

  if (await templateNameTaken(guildId, folderId, name, id)) {
    return refuse(409, "There is already a template with that name in this folder.");
  }

  const updated = await prisma.messageTemplate.update({
    where: { id },
    data: { name, folderId, content, embeds, buttons, selects, reactions, inTickets: flag.value ?? row.inTickets },
  });
  return ok(templateDto(updated));
}

async function deleteTemplate(guildId: string, id: number): Promise<Reply> {
  const row = await prisma.messageTemplate.findFirst({ where: { id, guildId } });
  if (!row) return refuse(404, "That template was not found.");
  await prisma.messageTemplate.delete({ where: { id } });
  return ok({ ok: true });
}

export interface CustomEmoji {
  id: string;
  name: string;
  animated: boolean;
  url: string;
}

/** The server's custom emoji the bot can use, for pickers that offer them beside the unicode ones. */
export function customEmojis(guild: Guild): CustomEmoji[] {
  return guild.emojis.cache
    .filter((emoji) => emoji.available !== false && emoji.name !== null)
    .map((emoji) => ({
      id: emoji.id,
      name: emoji.name ?? "",
      animated: emoji.animated === true,
      url: emoji.imageURL({ size: 64 }),
    }));
}

function listEmojis(guild: Guild): Reply {
  return ok(customEmojis(guild).map((emoji) => ({ ...emoji, token: `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` })));
}

/** What each variable becomes for this send. The preview in the dashboard uses the same names. */
function variableValues(guild: Guild, channel: { id: string; name: string }, sender: string): VariableValues {
  const now = new Date();
  return {
    server: guild.name,
    members: guild.memberCount.toLocaleString("en-US"),
    channel: `<#${channel.id}>`,
    "channel.name": channel.name,
    date: discordTimestamp(now, "D"),
    time: discordTimestamp(now, "t"),
    now: discordTimestamp(now, "f"),
    sender,
    bot: guild.members.me?.displayName ?? guild.client.user.username,
    "server.icon": guild.iconURL({ size: 256 }) ?? "",
  };
}

/**
 * The webhook the bot sends through when a message goes out under another name.
 * One per channel is reused, found by name among the ones the bot owns, so
 * sending twice does not leave a pile of webhooks behind.
 */
async function webhookFor(channel: TextChannel | NewsChannel, botId: string, name: string): Promise<Webhook> {
  const existing = (await channel.fetchWebhooks()).find((hook) => hook.owner?.id === botId && hook.name === name);
  return existing ?? channel.createWebhook({ name });
}

/** One message the Message creator sent, as the bot keeps it. */
export interface SendRecord {
  guildId: string;
  templateId: number | null;
  channelId: string;
  messageId: string;
  viaWebhook: boolean;
}

export interface SendDto {
  id: number;
  templateId: number | null;
  /** Null when it was not sent from a template, or the template has since been deleted. */
  templateName: string | null;
  channelId: string;
  messageId: string;
  url: string;
  viaWebhook: boolean;
  sentAt: string;
}

/** How many sends one list answers with. Older ones stay stored; nothing is pruned. */
export const SENDS_PAGE = 100;

export type RecordSend = (record: SendRecord) => Promise<void>;

export const recordSend: RecordSend = async (record) => {
  await prisma.messageSend.create({ data: record });
};

/** Discord's own link for a message, the same one Copy Message Link gives. */
export function messageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export function sendDto(
  row: { id: number; guildId: string; templateId: number | null; channelId: string; messageId: string; viaWebhook: boolean; sentAt: Date },
  templateNames: ReadonlyMap<number, string>,
): SendDto {
  return {
    id: row.id,
    templateId: row.templateId,
    templateName: row.templateId === null ? null : (templateNames.get(row.templateId) ?? null),
    channelId: row.channelId,
    messageId: row.messageId,
    url: messageUrl(row.guildId, row.channelId, row.messageId),
    viaWebhook: row.viaWebhook,
    sentAt: row.sentAt.toISOString(),
  };
}

/** The newest sends of one template, or of the whole server when `templateId` is null, with how many there are in all. */
async function listSends(guildId: string, templateId: number | null): Promise<Reply> {
  const where = templateId === null ? { guildId } : { guildId, templateId };
  const [rows, total, templates] = await Promise.all([
    prisma.messageSend.findMany({ where, orderBy: { sentAt: "desc" }, take: SENDS_PAGE }),
    prisma.messageSend.count({ where }),
    prisma.messageTemplate.findMany({ where: { guildId }, select: { id: true, name: true } }),
  ]);
  const names = new Map(templates.map((template) => [template.id, template.name]));
  return ok({ sends: rows.map((row) => sendDto(row, names)), total });
}

/** Takes a message off the list. The message itself stays in Discord. */
async function forgetSend(guildId: string, id: number): Promise<Reply> {
  const removed = await prisma.messageSend.deleteMany({ where: { id, guildId } });
  if (removed.count === 0) return refuse(404, "That sent message is not on the list any more.");
  return ok({ ok: true });
}

export async function sendMessage(
  guild: Guild,
  payload: Record<string, unknown>,
  labels: SystemLabels,
  record: RecordSend = recordSend,
): Promise<Reply> {
  const parsed = parseMessage(payload);
  if (!parsed.ok) return messageErrors(parsed.errors);

  const options = parseSendOptions(payload);
  if (!options.ok) return refuse(400, options.error);
  const choice = options.value;

  const channel = guild.channels.cache.get(choice.channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !("send" in channel)) {
    return refuse(404, "Pick a text channel on this server to send it to.");
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  const permissions = me ? channel.permissionsFor(me) : null;
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) {
    return refuse(403, `The bot can't send messages in #${channel.name}. Give it View Channel and Send Messages there.`);
  }
  if (parsed.value.embeds.length > 0 && !permissions.has(PermissionFlagsBits.EmbedLinks)) {
    return refuse(403, `The bot needs Embed Links in #${channel.name} to send an embed.`);
  }

  // Sending as another name goes through a webhook, which has to be made in a plain text or announcement channel.
  const asOther = choice.asName !== "";
  if (asOther) {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      return refuse(400, "Sending under another name only works in a text or announcement channel, not in a thread.");
    }
    if (!permissions.has(PermissionFlagsBits.ManageWebhooks)) {
      return refuse(403, `Sending under another name needs the bot to have Manage Webhooks in #${channel.name}.`);
    }
  }

  // Variables can lengthen a message, so what is sent is checked again after they are filled in.
  const sender = typeof payload.sender === "string" && payload.sender.trim() !== "" ? payload.sender.trim().slice(0, 80) : labels.defaultSender;
  const filled = parseMessage(applyVariablesToMessage(parsed.value, variableValues(guild, channel, sender)));
  if (!filled.ok) {
    return refuse(400, `Once the variables are filled in, the message no longer fits Discord's limits: ${filled.errors[0]?.message ?? "it is too long."}`);
  }

  const names = namesOf(guild, { role: labels.unknownRole, channel: labels.unknownChannel });
  const emptyMenu = firstEmptyLimitedMenu(filled.value, names);
  if (emptyMenu >= 0) {
    return refuse(400, `Menu ${emptyMenu + 1} is limited to channels or roles that no longer exist. Pick some that do, or clear the limit.`);
  }

  const flags: (MessageFlags.SuppressNotifications | MessageFlags.SuppressEmbeds)[] = [];
  if (choice.silent) flags.push(MessageFlags.SuppressNotifications);
  if (choice.suppressEmbeds) flags.push(MessageFlags.SuppressEmbeds);

  const body = {
    ...toDiscordPayload(filled.value, names),
    ...(choice.tts ? { tts: true } : {}),
    ...(flags.length > 0 ? { flags } : {}),
    // People and roles can be mentioned. @everyone and @here only ping when
    // the person sending turned that on for this send, which is off by default.
    allowedMentions: { parse: choice.allowEveryone ? (["users", "roles", "everyone"] as const) : (["users", "roles"] as const) },
  };

  const warnings: string[] = [];
  let sent: Message;
  try {
    if (asOther && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) {
      const hook = await webhookFor(channel, guild.client.user.id, labels.webhookName);
      sent = await hook.send({
        ...body,
        username: choice.asName,
        ...(choice.asAvatarUrl ? { avatarURL: choice.asAvatarUrl } : {}),
      });
      if (choice.replyTo) warnings.push("Reply was skipped, because a message sent under another name can't be a reply.");
    } else {
      sent = await channel.send({
        ...body,
        ...(choice.replyTo ? { reply: { messageReference: choice.replyTo, failIfNotExists: false } } : {}),
      });
    }
  } catch (error) {
    console.error("messages: send failed:", error);
    return refuse(400, "Discord refused the message. Check the bot's permissions in that channel and try again.");
  }

  // The message is out by now. What follows is extra, so a failure is reported
  // beside the success and never turns it into an error.
  await saveInteractions(guild.id, channel.id, sent.id, filled.value).catch((error) => {
    console.error("messages: could not keep what the buttons do:", error);
    warnings.push("The message was sent, but its buttons and menus won't respond, because the bot couldn't save what they do.");
  });
  for (const reaction of filled.value.reactions) {
    await sent.react(reaction).catch(() => {
      const note = "Some reactions could not be added. The bot needs Add Reactions and Read Message History.";
      if (!warnings.includes(note)) warnings.push(note);
    });
  }
  if (choice.pin) {
    await sent.pin().catch(() => warnings.push("The message could not be pinned. The bot needs Manage Messages, and a channel holds at most 50 pins."));
  }
  if (choice.publish) {
    if (channel.type === ChannelType.GuildAnnouncement) {
      await sent.crosspost().catch(() => warnings.push("The message could not be published to followers."));
    } else {
      warnings.push("Publish was skipped because that is not an announcement channel.");
    }
  }
  if (choice.threadName !== "") {
    await sent.startThread({ name: choice.threadName }).catch(() => warnings.push("The thread could not be started. The bot needs Create Public Threads."));
  }

  const asked = typeof payload.templateId === "number" && Number.isInteger(payload.templateId) ? payload.templateId : null;
  // Only a template of this server is named on the record, so a stray id cannot attach a send to someone else's.
  const templateId =
    asked === null
      ? null
      : await prisma.messageTemplate
          .updateMany({ where: { id: asked, guildId: guild.id }, data: { lastSentAt: new Date() } })
          .then((result) => (result.count > 0 ? asked : null))
          .catch(() => null);
  await record({ guildId: guild.id, templateId, channelId: channel.id, messageId: sent.id, viaWebhook: asOther }).catch((error) => {
    console.error("messages: could not record the send:", error);
    warnings.push("The message was sent, but it could not be added to the list of sent messages, so replacing it later needs its link.");
  });
  return ok({ ok: true, messageId: sent.id, url: sent.url, warnings });
}

/** A link Discord gives for a message: Copy Message Link in its menu. */
export function parseMessageLink(value: unknown): { guildId: string; channelId: string; messageId: string } | null {
  const match = /^https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/.exec(typeof value === "string" ? value.trim() : "");
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

const NOT_OURS = "That message was not sent by TierZero. Discord only lets whoever sent a message edit it.";

/**
 * Replaces a message the bot sent earlier with the one in the editor. Discord
 * lets only the sender edit, so a message sent under another name is edited
 * through the same webhook that sent it.
 */
async function editSentMessage(guild: Guild, payload: Record<string, unknown>, labels: SystemLabels): Promise<Reply> {
  const parsed = parseMessage(payload);
  if (!parsed.ok) return messageErrors(parsed.errors);

  const link = parseMessageLink(payload.link);
  if (!link) return refuse(400, "Paste the link to the message. In Discord, open the message's menu and choose Copy Message Link.");
  if (link.guildId !== guild.id) return refuse(400, "That message is on another server.");

  const channel = guild.channels.cache.get(link.channelId) ?? (await guild.channels.fetch(link.channelId).catch(() => null));
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return refuse(404, "The channel of that message was not found.");

  const message = await channel.messages.fetch(link.messageId).catch(() => null);
  if (!message) return refuse(404, "That message was not found. It may have been deleted, or the bot cannot read that channel.");

  const sender = typeof payload.sender === "string" && payload.sender.trim() !== "" ? payload.sender.trim().slice(0, 80) : labels.defaultSender;
  const filled = parseMessage(applyVariablesToMessage(parsed.value, variableValues(guild, channel, sender)));
  if (!filled.ok) {
    return refuse(400, `Once the variables are filled in, the message no longer fits Discord's limits: ${filled.errors[0]?.message ?? "it is too long."}`);
  }
  const names = namesOf(guild, { role: labels.unknownRole, channel: labels.unknownChannel });
  const emptyMenu = firstEmptyLimitedMenu(filled.value, names);
  if (emptyMenu >= 0) {
    return refuse(400, `Menu ${emptyMenu + 1} is limited to channels or roles that no longer exist. Pick some that do, or clear the limit.`);
  }

  const body = {
    ...toDiscordPayload(filled.value, names),
    // Left out, Discord would keep the old text under a message that now has none.
    content: filled.value.content,
    allowedMentions: { parse: payload.allowEveryone === true ? (["users", "roles", "everyone"] as const) : (["users", "roles"] as const) },
  };

  const botId = guild.client.user.id;
  try {
    if (message.webhookId) {
      const home = channel.isThread() ? channel.parent : channel;
      if (!home || !("fetchWebhooks" in home)) return refuse(403, NOT_OURS);
      const hooks = await home.fetchWebhooks().catch(() => null);
      if (!hooks) return refuse(403, `Editing a message sent under another name needs the bot to have Manage Webhooks in #${home.name}.`);
      const hook = hooks.find((entry) => entry.id === message.webhookId && entry.owner?.id === botId);
      if (!hook) return refuse(403, NOT_OURS);
      await hook.editMessage(message.id, { ...body, ...(channel.isThread() ? { threadId: channel.id } : {}) });
    } else if (message.author.id === botId) {
      await message.edit(body);
    } else {
      return refuse(403, NOT_OURS);
    }
  } catch (error) {
    console.error("messages: edit failed:", error);
    return refuse(400, "Discord refused the change. Check the bot's permissions in that channel and try again.");
  }

  const warnings: string[] = [];
  await saveInteractions(guild.id, channel.id, message.id, filled.value).catch(() => {
    warnings.push("The message was changed, but its buttons and menus won't respond, because the bot couldn't save what they do.");
  });
  if (filled.value.reactions.length > 0) warnings.push("Reactions are only added when a message is first sent, so they were left as they are.");
  return ok({ ok: true, messageId: message.id, url: message.url, warnings });
}
