/**
 * The permissions the bot asks for when it is added to a server, one entry per
 * thing a shipped feature does. The values are Discord's documented bit
 * positions; the test checks the number below against them. docs/install.md and
 * docs/install-beginner.md quote the same list, so changing one means changing
 * all three.
 */
export const INVITE_PERMISSION_BITS = {
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  /** Ticket channels. */
  ManageChannels: 1n << 4n,
  AddReactions: 1n << 6n,
  /** Who did what, for server logs and deleted messages. */
  ViewAuditLog: 1n << 7n,
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  /** Purge, automod and pinning a sent message. */
  ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n,
  /** Ticket transcripts. */
  AttachFiles: 1n << 15n,
  ReadMessageHistory: 1n << 16n,
  /** The Message creator's "Let @everyone and @here ping". */
  MentionEveryone: 1n << 17n,
  /** Reactions and buttons with another server's emoji. */
  UseExternalEmojis: 1n << 18n,
  /** Role menus, welcome roles, level rewards and ticket channel access. */
  ManageRoles: 1n << 28n,
  /** Sending under another name, and ticket replies with the staff member's name. */
  ManageWebhooks: 1n << 29n,
  ManageThreads: 1n << 34n,
  /** Starting a thread on a sent message. */
  CreatePublicThreads: 1n << 35n,
  /** Tickets that open as threads. */
  CreatePrivateThreads: 1n << 36n,
  SendMessagesInThreads: 1n << 38n,
  /** Timeouts. */
  ModerateMembers: 1n << 40n,
} as const;

export type InvitePermission = keyof typeof INVITE_PERMISSION_BITS;

export const INVITE_PERMISSIONS = Object.values(INVITE_PERMISSION_BITS)
  .reduce((all, bit) => all | bit, 0n)
  .toString();

/** The link that adds the bot to a server, or null while DISCORD_CLIENT_ID is unset. */
export function inviteUrl(): string | null {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return null;
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=${INVITE_PERMISSIONS}&scope=bot%20applications.commands`;
}

/** Discord's permission names the way its own settings screens write them. */
export function permissionLabel(name: string): string {
  const special: Record<string, string> = {
    ViewAuditLog: "View Audit Log",
    SendTTSMessages: "Send Text-to-Speech Messages",
    UseVAD: "Use Voice Activity",
    ManageGuild: "Manage Server",
    ManageGuildExpressions: "Manage Expressions",
    MentionEveryone: "Mention @everyone, @here and All Roles",
    ModerateMembers: "Timeout Members",
  };
  return special[name] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * The permissions a feature needs that the bot does not have server-wide.
 * Administrator covers everything. Null when the bot's permissions are not
 * known, which must not read as "nothing missing".
 */
export function missingPermissions(requires: readonly string[] | undefined, has: readonly string[] | null | undefined): string[] | null {
  if (!has) return null;
  if (has.includes("Administrator")) return [];
  return (requires ?? []).filter((name) => !has.includes(name));
}

/**
 * The permissions the invite asks for that the bot does not hold server-wide,
 * in the invite's order. Null when the bot's permissions are not known.
 */
export function missingInvitePermissions(has: readonly string[] | null | undefined): InvitePermission[] | null {
  return missingPermissions(Object.keys(INVITE_PERMISSION_BITS), has) as InvitePermission[] | null;
}
