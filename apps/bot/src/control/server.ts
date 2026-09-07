import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ChannelType, type Client } from "discord.js";
import type { ModuleRegistry } from "@tier0/core";
import type { GuildState } from "../runtime/guild-state";
import type { CommandSync } from "../runtime/commands";
import { config } from "../config";

interface Deps {
  client: Client;
  registry: ModuleRegistry;
  state: GuildState;
  commands: CommandSync;
}

/**
 * A small control plane the dashboard calls for live Discord data and to
 * announce that a guild's configuration changed.
 *
 * Bound to the compose network only. Adding Redis or a message broker to an
 * install that is meant to be one command is not worth what it would buy here.
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

    const guildMatch = /^\/guilds\/(\d+)\/(channels|roles|reload)$/.exec(url.pathname);

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

    if (guildMatch) {
      const [, guildId, resource] = guildMatch;
      const guild = client.guilds.cache.get(guildId);
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
        state.invalidate(guildId);
        commands.schedule(guildId);
        return send(202, { scheduled: true });
      }
    }

    return send(404, { error: "not found" });
  });

  server.listen(config.controlPort, "0.0.0.0", () => {
    console.log(`Control API listening on ${config.controlPort}`);
  });
}

const TEXTUAL = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

function authorised(header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(config.controlSecret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
