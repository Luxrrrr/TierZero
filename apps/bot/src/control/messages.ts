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
function storedBody(row: TemplateRow): MessageBody {
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

function messageErrors(errors: { path: string; message: string }[]): Reply {
  return { status: 400, body: { error: errors[0]?.message ?? "The message is not valid.", errors } };
}

async function createTemplate(guildId: string, payload: Record<string, unknown>): Promise<Reply> {
  const name = cleanName(payload.name, MESSAGE_LIMITS.templateName, "The template name");
  if (!name.ok) return refuse(400, name.error);

  const message = parseMessage(payload);
  if (!message.ok) return messageErrors(message.errors);

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
    data: { name, folderId, content, embeds, buttons, selects, reactions },
  });
  return ok(templateDto(updated));
}

async function deleteTemplate(guildId: string, id: number): Promise<Reply> {
  const row = await prisma.messageTemplate.findFirst({ where: { id, guildId } });
  if (!row) return refuse(404, "That template was not found.");
  await prisma.messageTemplate.delete({ where: { id } });
  return ok({ ok: true });
}

/** The server's custom emoji, so the dashboard can offer them beside the unicode ones. */
function listEmojis(guild: Guild): Reply {
  return ok(
    guild.emojis.cache
      .filter((emoji) => emoji.available !== false && emoji.name !== null)
      .map((emoji) => ({
        id: emoji.id,
        name: emoji.name ?? "",
        animated: emoji.animated === true,
        token: `<${emoji.animated ? "a" : ""}:${emoji.name ?? ""}:${emoji.id}>`,
        url: emoji.imageURL({ size: 64 }),
      })),
  );
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

async function sendMessage(guild: Guild, payload: Record<string, unknown>, labels: SystemLabels): Promise<Reply> {
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

  const templateId = typeof payload.templateId === "number" ? payload.templateId : null;
  if (templateId !== null) {
    await prisma.messageTemplate
      .updateMany({ where: { id: templateId, guildId: guild.id }, data: { lastSentAt: new Date() } })
      .catch(() => undefined);
  }
  return ok({ ok: true, messageId: sent.id, url: sent.url, warnings });
}
