import { createServer, type IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ChannelType, type Client } from "discord.js";
import type { ModuleRegistry } from "@tier0/core";
import type { GuildState } from "../runtime/guild-state.js";
import type { CommandSync } from "../runtime/commands.js";
import { config } from "../config.js";

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
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    const url = new URL(req.url ?? "/", "http://control");

    if (url.pathname === "/health") {
      return send(200, { ok: client.isReady(), guilds: client.guilds.cache.size });
    }

    if (!authorised(req.headers.authorization)) {
      return send(401, { error: "unauthorised" });
    }

    if (url.pathname === "/guilds") {
      return send(
        200,
        client.guilds.cache.map((guild) => ({
          id: guild.id,
          name: guild.name,
          icon: guild.iconURL(),
          memberCount: guild.memberCount,
        })),
      );
    }

    if (url.pathname === "/modules") {
      return send(200, registry.describe());
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
      const [, guildId, commandName] = commandMatch;
      const guild = guildId === undefined ? undefined : client.guilds.cache.get(guildId);
      if (!guild || commandName === undefined) return send(404, { error: "guild not found" });
      if (!registry.ownerOf(commandName)) return send(404, { error: "unknown command" });

      if (req.method !== "PATCH") return send(404, { error: "not found" });

      const body = await readJsonBody(req);
      if (!body.ok) return send(400, { error: body.error });
      if (!isPlainObject(body.value)) {
        return send(400, { error: "body must be a JSON object" });
      }

      const { enabled, allowRoles, denyChannels } = body.value as {
        enabled?: unknown;
        allowRoles?: unknown;
        denyChannels?: unknown;
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

      await commands.setOverride(guild.id, commandName, { enabled, allowRoles, denyChannels });
      return send(200, { ok: true });
    }

    const guildMatch = /^\/guilds\/(\d+)\/(channels|roles|reload)$/.exec(url.pathname);
    if (guildMatch) {
      const [, guildId, resource] = guildMatch;
      const guild = guildId === undefined ? undefined : client.guilds.cache.get(guildId);
      if (!guild) return send(404, { error: "guild not found" });

      if (resource === "channels") {
        return send(
          200,
          guild.channels.cache
            .filter((c) => TEXTUAL.has(c.type) || c.type === ChannelType.GuildVoice)
            .map((c) => ({ id: c.id, name: c.name, type: c.type })),
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
              colour: role.hexColor,
              // The dashboard greys these out: the bot cannot assign a role
              // positioned above its own.
              assignable: role.position < ceiling,
            })),
        );
      }

      if (resource === "reload" && req.method === "POST") {
        state.invalidate(guild.id);
        commands.schedule(guild.id);
        return send(202, { scheduled: true });
      }
    }

    return send(404, { error: "not found" });
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

const TEXTUAL = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

function authorised(header: string | undefined): boolean {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
