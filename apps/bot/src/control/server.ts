import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ChannelType, type Client, type NonThreadGuildBasedChannel } from "discord.js";
import { parseMessage, type MessageBody, type ModuleRegistry } from "@tier0/core";
import { partPatchProblem, permissionOverrideAllowed, resolveCommandKey } from "../runtime/command-policy.js";
import type { GuildState } from "../runtime/guild-state.js";
import type { CommandSync } from "../runtime/commands.js";
import { prisma } from "@tier0/db";
import { config } from "../config.js";
import { systemLabels } from "../runtime/system-messages.js";
import { rowStatuses, runRowAction } from "./rows.js";
import { customEmojis, handleMessages } from "./messages.js";
import { handleMod } from "./mod/index.js";
import { handleTickets } from "./tickets/index.js";
import { rawHeaders, type Reply } from "./mod/types.js";
import { leaderboardPage, moduleNotices } from "./public-pages.js";

/** Which of these channels belong to a ticket. A database failure marks none, which only shows them as usual. */
async function ticketChannelIds(guildId: string, channelIds: string[]): Promise<Set<string>> {
  if (channelIds.length === 0) return new Set();
  const rows = await prisma.ticket
    .findMany({ where: { guildId, channelId: { in: channelIds } }, select: { channelId: true } })
    .catch(() => []);
  return new Set(rows.map((row) => row.channelId));
}

interface Deps {
  client: Client;
  registry: ModuleRegistry;
  state: GuildState;
  commands: CommandSync;
}

/**
 * A small control plane the dashboard calls for live Discord data and to
 * write guild configuration. The bot owns this data: every write lands here
 * so that persisting a change and refreshing the running bot happen as one
 * step, and the database and the gateway connection can never disagree.
 *
 * Bound to localhost by default. Set CONTROL_HOST if the dashboard runs on a
 * different machine.
 */
export function startControlApi({ client, registry, state, commands }: Deps): void {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const sendReply = (reply: Reply) => {
      if (!reply.raw) return send(reply.status, reply.body);
      res.writeHead(reply.status, rawHeaders(reply.raw));
      res.end(reply.raw.text);
    };

    const url = new URL(req.url ?? "/", "http://control");

    if (url.pathname === "/health") {
      return send(200, { ok: client.isReady(), guilds: client.guilds.cache.size });
    }

    if (!authorized(req.headers.authorization)) {
      return send(401, { error: "unauthorised" });
    }

    if (url.pathname === "/guilds") {
      return send(
        200,
        client.guilds.cache.map((guild) => ({
          id: guild.id,
          name: guild.name,
          // The hash rather than iconURL(), because the dashboard builds its
          // own URL and asks the CDN for the size that surface needs.
          icon: guild.icon,
          memberCount: guild.memberCount,
          // What the bot may do server-wide, by Discord's permission names, so the
          // dashboard can say which feature is missing one. Null before the bot's
          // own member is cached.
          permissions: guild.members.me ? guild.members.me.permissions.toArray() : null,
        })),
      );
    }

    if (url.pathname === "/modules") {
      return send(200, registry.describe());
    }

    const messagesMatch = /^\/guilds\/(\d+)\/messages(?:\/(.*))?$/.exec(url.pathname);
    if (messagesMatch) {
      const [, guildId, rest] = messagesMatch;
      const guild = guildId === undefined ? undefined : client.guilds.cache.get(guildId);
      if (!guild) return send(404, { error: "guild not found" });

      let parsed: unknown = undefined;
      if (req.method !== "GET" && req.method !== "DELETE") {
        const body = await readJsonBody(req);
        if (!body.ok) return send(400, { error: body.error });
        parsed = body.value;
      }
      const segments = rest ? decodeSegments(rest) : [];
      if (!segments) return send(400, { error: "the path is not valid" });
      const reply = await handleMessages({
        guild,
        method: req.method ?? "GET",
        segments,
        body: parsed,
        labels: await systemLabels(state, guild.id),
      });
      return reply ? sendReply(reply) : send(404, { error: "not found" });
    }

    const modMatch = /^\/guilds\/(\d+)\/mod\/(.+)$/.exec(url.pathname);
    if (modMatch) {
      const [, guildId, rest] = modMatch;
      const guild = guildId === undefined ? undefined : client.guilds.cache.get(guildId);
      if (!guild || rest === undefined) return send(404, { error: "guild not found" });

      let parsed: unknown = undefined;
      if (req.method !== "GET") {
        const body = await readJsonBody(req);
        if (!body.ok) return send(400, { error: body.error });
        parsed = body.value;
      }
      const segments = decodeSegments(rest);
      if (!segments) return send(400, { error: "the path is not valid" });
      const reply = await handleMod({
        client,
        guild,
        state,
        method: req.method ?? "GET",
        segments,
        query: url.searchParams,
        body: parsed,
      });
      return reply ? sendReply(reply) : send(404, { error: "not found" });
    }

    const ticketsMatch = /^\/guilds\/(\d+)\/tickets\/(.+)$/.exec(url.pathname);
    if (ticketsMatch) {
      const [, guildId, rest] = ticketsMatch;
      const guild = guildId === undefined ? undefined : client.guilds.cache.get(guildId);
      if (!guild || rest === undefined) return send(404, { error: "guild not found" });

      let parsed: unknown = undefined;
      if (req.method !== "GET") {
        const body = await readJsonBody(req);
        if (!body.ok) return send(400, { error: body.error });
        parsed = body.value;
      }
      const segments = decodeSegments(rest);
      if (!segments) return send(400, { error: "the path is not valid" });
      const reply = await handleTickets({
        client,
        guild,
        state,
        method: req.method ?? "GET",
        segments,
        query: url.searchParams,
        body: parsed,
      });
      return reply ? sendReply(reply) : send(404, { error: "not found" });
    }

    // Read only. The public leaderboard page, and the lines a module shows above its settings.
    const leaderboardMatch = /^\/guilds\/(\d+)\/leaderboard$/.exec(url.pathname);
    if (leaderboardMatch && req.method === "GET") {
      const reply = await leaderboardPage(state, client.guilds.cache.get(leaderboardMatch[1] ?? ""), url.searchParams.get("page"));
      return send(reply.status, reply.body);
    }
    const noticesMatch = /^\/guilds\/(\d+)\/modules\/([^/]+)\/notices$/.exec(url.pathname);
    if (noticesMatch && req.method === "GET") {
      const guild = client.guilds.cache.get(noticesMatch[1] ?? "");
      if (!guild) return send(404, { error: "guild not found" });
      const reply = await moduleNotices(registry, state, guild, noticesMatch[2] ?? "");
      return send(reply.status, reply.body);
    }

    const rowsMatch =/^\/guilds\/(\d+)\/modules\/([^/]+)\/rows\/([^/]+)\/(status|actions\/([^/]+))$/.exec(
      url.pathname,
    );
    if (rowsMatch) {
      const [, guildId, moduleId, encodedPath, what, actionId] = rowsMatch;
      const guild = guildId === undefined ? undefined : client.guilds.cache.get(guildId);
      if (!guild || moduleId === undefined || encodedPath === undefined) {
        return send(404, { error: "guild not found" });
      }
      let path: string;
      try {
        path = decodeURIComponent(encodedPath);
      } catch {
        return send(400, { error: "the path is not valid" });
      }

      if (what === "status" && req.method === "GET") {
        const reply = await rowStatuses(registry, state, guild, moduleId, path);
        return send(reply.status, reply.body);
      }
      if (actionId !== undefined && req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body.ok) return send(400, { error: body.error });
        if (!isPlainObject(body.value)) return send(400, { error: "body must be a JSON object" });
        const reply = await runRowAction(registry, state, guild, moduleId, path, actionId, body.value.input);
        return send(reply.status, reply.body);
      }
      return send(404, { error: "not found" });
    }

    const moduleMatch = /^\/guilds\/(\d+)\/modules\/([^/]+)$/.exec(url.pathname);
    if (moduleMatch) {
      const [, guildId, moduleId] = moduleMatch;
      const guild = guildId === undefined ? undefined : client.guilds.cache.get(guildId);
      if (!guild || moduleId === undefined) return send(404, { error: "guild not found" });
      if (!registry.get(moduleId)) return send(404, { error: "unknown module" });

      if (req.method !== "PATCH") return send(404, { error: "not found" });

      const body = await readJsonBody(req);
      if (!body.ok) return send(400, { error: body.error });
      if (!isPlainObject(body.value)) {
        return send(400, { error: "body must be a JSON object" });
      }

      const { enabled, settings } = body.value as { enabled?: unknown; settings?: unknown };
      if (enabled !== undefined && typeof enabled !== "boolean") {
        return send(400, { error: "enabled must be a boolean" });
      }
      if (settings !== undefined && !isPlainObject(settings)) {
        return send(400, { error: "settings must be an object" });
      }
      if (enabled === false && registry.get(moduleId)?.alwaysOn === true) {
        return send(400, { error: "That part of the bot is always on and cannot be switched off." });
      }

      const result = await state.applyModuleUpdate(
        guild,
        moduleId,
        { enabled, settings },
        commands,
      );
      if (!result.ok) return send(422, { errors: result.errors });
      return send(200, { ok: true });
    }

    const modulesListMatch = /^\/guilds\/(\d+)\/modules$/.exec(url.pathname);
    if (modulesListMatch) {
      const [, guildId] = modulesListMatch;
      const guild = guildId === undefined ? undefined : client.guilds.cache.get(guildId);
      if (!guild) return send(404, { error: "guild not found" });
      if (req.method !== "GET") return send(404, { error: "not found" });

      return send(200, await state.describeForGuild(guild.id));
    }

    const commandMatch = /^\/guilds\/(\d+)\/commands\/([^/]+)$/.exec(url.pathname);
    if (commandMatch) {
      const [, guildId, rawName] = commandMatch;
      // Right-click entries have spaces in their names, which arrive percent-encoded.
      let commandName: string | undefined;
      try {
        commandName = rawName === undefined ? undefined : decodeURIComponent(rawName);
      } catch {
        return send(400, { error: "that command name is not valid" });
      }
      const guild = guildId === undefined ? undefined : client.guilds.cache.get(guildId);
      if (!guild || commandName === undefined) return send(404, { error: "guild not found" });
      const target = resolveCommandKey(
        registry.describe().flatMap((module) => module.commands),
        commandName,
      );
      if (!target) return send(404, { error: "unknown command" });

      if (req.method !== "PATCH") return send(404, { error: "not found" });

      const body = await readJsonBody(req);
      if (!body.ok) return send(400, { error: body.error });
      if (!isPlainObject(body.value)) {
        return send(400, { error: "body must be a JSON object" });
      }

      const { enabled, allowRoles, denyChannels, allowChannels, permissions, ephemeral, customReply } = body.value as {
        enabled?: unknown;
        allowRoles?: unknown;
        denyChannels?: unknown;
        allowChannels?: unknown;
        permissions?: unknown;
        ephemeral?: unknown;
        customReply?: unknown;
      };
      if (enabled !== undefined && typeof enabled !== "boolean") {
        return send(400, { error: "enabled must be a boolean" });
      }
      if (allowRoles !== undefined && !isStringArray(allowRoles)) {
        return send(400, { error: "allowRoles must be a list of role IDs" });
      }
      if (denyChannels !== undefined && !isStringArray(denyChannels)) {
        return send(400, { error: "denyChannels must be a list of channel IDs" });
      }
      if (allowChannels !== undefined && !isStringArray(allowChannels)) {
        return send(400, { error: "allowChannels must be a list of channel IDs" });
      }

      if (target.kind === "part") {
        const problem = partPatchProblem(body.value as Record<string, unknown>);
        if (problem) return send(400, { error: problem });
        await commands.setOverride(guild.id, target.key, { enabled, allowRoles, denyChannels, allowChannels }, { resync: false });
        return send(200, { ok: true });
      }
      const summary = target.command;

      if (permissions !== undefined && permissions !== null) {
        if (
          typeof permissions !== "string" ||
          !permissionOverrideAllowed(permissions, summary?.defaultPermissions ?? null)
        ) {
          return send(400, {
            error: "that permission cannot be set on this command; a command that already needs one can only be made stricter",
          });
        }
      }
      if (ephemeral !== undefined && ephemeral !== null && typeof ephemeral !== "boolean") {
        return send(400, { error: "ephemeral must be true, false or null" });
      }
      if (typeof ephemeral === "boolean" && summary?.repliesVary) {
        return send(400, { error: "that command decides for each reply whether it is private" });
      }
      let reply: MessageBody | null | undefined;
      if (customReply !== undefined) {
        if (customReply === null) {
          reply = null;
        } else if (!summary?.response) {
          return send(400, { error: "that command does not have a reply that can be rewritten" });
        } else {
          const parsed = parseMessage(customReply);
          if (!parsed.ok) {
            return send(400, { error: parsed.errors[0]?.message ?? "the reply is not valid", errors: parsed.errors });
          }
          reply = parsed.value;
        }
      }

      await commands.setOverride(guild.id, commandName, {
        enabled,
        allowRoles,
        denyChannels,
        allowChannels,
        permissions: permissions as string | null | undefined,
        ephemeral: ephemeral as boolean | null | undefined,
        customReply: reply,
      });
      return send(200, { ok: true });
    }

    const guildMatch = /^\/guilds\/(\d+)\/(channels|roles|emojis|command-sync|reload)$/.exec(url.pathname);
    if (guildMatch) {
      const [, guildId, resource] = guildMatch;
      const guild = guildId === undefined ? undefined : client.guilds.cache.get(guildId);
      if (!guild) return send(404, { error: "guild not found" });

      if (resource === "channels") {
        const pickable = guild.channels.cache.filter((c): c is NonThreadGuildBasedChannel => PICKABLE.has(c.type));
        // A ticket's own channel makes no sense as a place to send to or log in, so pickers can leave it out.
        const tickets = await ticketChannelIds(guild.id, [...pickable.keys()]);
        return send(
          200,
          pickable.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            // The dashboard groups the picker by category and orders it the
            // way Discord does, which needs both of these.
            parentId: c.parentId,
            position: c.position,
            ...(tickets.has(c.id) ? { ticket: true } : {}),
          })),
        );
      }

      if (resource === "roles") {
        const ceiling = guild.members.me?.roles.highest.position ?? 0;
        return send(
          200,
          guild.roles.cache
            .filter((role) => !role.managed && role.id !== guild.id)
            .map((role) => ({
              id: role.id,
              name: role.name,
              color: role.hexColor,
              // The dashboard greys these out: the bot cannot assign a role
              // positioned above its own.
              assignable: role.position < ceiling,
            })),
        );
      }

      if (resource === "command-sync" && req.method === "GET") {
        return send(200, commands.status(guild.id));
      }

      if (resource === "emojis" && req.method === "GET") {
        return send(200, customEmojis(guild));
      }

      if (resource === "reload" && req.method === "POST") {
        state.invalidate(guild.id);
        commands.schedule(guild.id);
        return send(202, { scheduled: true });
      }
    }

    return send(404, { error: "not found" });
  };

  // Nothing thrown while handling a request may reach the process: an uncaught
  // error here would take the gateway connection down with it. The caller gets
  // a plain 500 and the detail stays in the log.
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error(`Control API request failed (${req.method} ${req.url?.split("?")[0]}):`, error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "The bot could not complete that request. The bot log has the details." }));
    });
  });

  // Without this, a port clash surfaces as an unhandled 'error' event and a
  // stack trace that says nothing about the cause.
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Control API port ${config.controlPort} is already in use. Another copy ` +
          `of the bot is probably still running. Stop it, or set CONTROL_PORT to a free port.`,
      );
    } else {
      console.error("Control API failed to start:", error);
    }
    process.exit(1);
  });

  server.listen(config.controlPort, config.controlHost, () => {
    console.log(`Control API listening on ${config.controlHost}:${config.controlPort}`);
  });
}

/**
 * Categories are here as well as the rest: a ticket category is a setting in
 * its own right, and the picker needs them to head its groups either way.
 */
const PICKABLE = new Set<ChannelType>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildForum,
  ChannelType.GuildCategory,
]);

function authorized(header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(config.controlSecret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

type BodyResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Reads and parses a JSON request body. An empty body parses as `{}`. */
function readJsonBody(req: IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", () => resolve({ ok: false, error: "failed to read request body" }));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({ ok: true, value: {} });
      try {
        resolve({ ok: true, value: JSON.parse(raw) });
      } catch {
        resolve({ ok: false, error: "malformed JSON body" });
      }
    });
  });
}

/** Splits a path tail and decodes each piece; null when any piece has a malformed percent sequence. */
function decodeSegments(rest: string): string[] | null {
  try {
    return rest.split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
