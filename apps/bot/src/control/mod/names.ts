import { Events, type Client, type Guild } from "discord.js";
import { automodRef, type UserRef } from "@tier0/core";

/**
 * Resolves Discord ids to something a person can read. Members come from the
 * guild, and anyone who has left is looked up as a plain user. A user Discord
 * no longer knows comes back with a null name, never an error, so a record
 * about someone who deleted their account still renders.
 *
 * A page can ask for dozens of ids at once, and an id Discord does not know
 * costs a round trip to find that out. Two things keep a page from waiting on
 * that: answers are remembered, including "unknown", and the whole batch gets
 * a short budget, after which anything still unresolved is shown by id. The
 * lookups carry on in the background, so the next load has the names.
 */

const KNOWN_TTL_MS = 10 * 60_000;
const UNKNOWN_TTL_MS = 30 * 60_000;
const BATCH_BUDGET_MS = 1500;

interface Remembered {
  ref: UserRef;
  until: number;
}

/** Most answers kept; past this the oldest are dropped so a long-running bot does not grow without bound. */
export const REMEMBERED_MAX = 5000;

const remembered = new Map<string, Remembered>();

/**
 * Stores an entry and evicts from the front of the map's insertion order until
 * it fits. The key is removed first so a refreshed answer counts as newest.
 */
export function rememberBounded<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}
const inFlight = new Map<string, Promise<UserRef>>();

const keyOf = (guildId: string, id: string) => `${guildId}:${id}`;

const watched = new WeakSet<Client>();

/**
 * A remembered answer says whether the member is in the server, which a ban,
 * a kick or someone leaving makes untrue at once. Those events drop the answer,
 * so the badge on a profile does not outlive the membership by ten minutes.
 */
function watchMembership(client: Client): void {
  if (watched.has(client) || typeof client.on !== "function") return;
  watched.add(client);
  const forget = (guildId: string, userId: string) => void remembered.delete(keyOf(guildId, userId));
  client.on(Events.GuildMemberAdd, (member) => forget(member.guild.id, member.id));
  client.on(Events.GuildMemberRemove, (member) => forget(member.guild.id, member.id));
  client.on(Events.GuildBanAdd, (ban) => forget(ban.guild.id, ban.user.id));
}

async function lookup(client: Client, guild: Guild, id: string): Promise<UserRef> {
  const member = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
  if (member) {
    return {
      userId: id,
      name: member.displayName,
      avatarUrl: member.displayAvatarURL({ size: 64 }),
      inServer: true,
    };
  }
  const user = client.users.cache.get(id) ?? (await client.users.fetch(id).catch(() => null));
  return {
    userId: id,
    name: user ? (user.globalName ?? user.username) : null,
    avatarUrl: user ? user.displayAvatarURL({ size: 64 }) : null,
    inServer: false,
  };
}

function resolveOne(client: Client, guild: Guild, id: string): Promise<UserRef> {
  const key = keyOf(guild.id, id);
  const hit = remembered.get(key);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.ref);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const started = lookup(client, guild, id)
    .then((ref) => {
      rememberBounded(
        remembered,
        key,
        { ref, until: Date.now() + (ref.name === null ? UNKNOWN_TTL_MS : KNOWN_TTL_MS) },
        REMEMBERED_MAX,
      );
      return ref;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

export interface ResolveOptions {
  /**
   * Most ids that may start a fresh Discord lookup in this call. Ids already
   * remembered or already being looked up are always used, so a large export
   * does not turn into thousands of requests. Ids the library has cached do
   * not count, because they need no request.
   */
  maxFetches?: number;
  /**
   * Leave the bot's own account as the account it is. Only for a person-shaped
   * question such as who wrote a logged message, where "Automod" would be wrong.
   */
  keepBotAccount?: boolean;
}

export async function resolveUsers(
  client: Client,
  guild: Guild,
  ids: Iterable<string>,
  options: ResolveOptions = {},
): Promise<Map<string, UserRef>> {
  watchMembership(client);
  const unique = [...new Set(ids)].filter((id) => /^\d{17,20}$/.test(id));
  const refs = new Map<string, UserRef>();
  let fetchesLeft = options.maxFetches ?? Infinity;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), BATCH_BUDGET_MS);
  });

  const botId = client.user?.id;
  const waiting: Promise<void>[] = [];
  for (const id of unique) {
    // The bot's own account is automod, which is shown by that name and never looked up.
    if (id === botId && !options.keepBotAccount) {
      refs.set(id, automodRef(id));
      continue;
    }
    const key = keyOf(guild.id, id);
    const hit = remembered.get(key);
    if (hit && hit.until > Date.now()) {
      refs.set(id, hit.ref);
      continue;
    }
    // An id the library already holds costs no request, so only the rest
    // count against the allowance.
    const cached = guild.members.cache.has(id) || client.users.cache.has(id);
    if (!inFlight.has(key) && !cached) {
      if (fetchesLeft <= 0) continue;
      fetchesLeft--;
    }
    waiting.push(
      Promise.race([resolveOne(client, guild, id), deadline]).then((answer) => {
        if (answer !== "late") refs.set(id, answer);
      }),
    );
  }

  try {
    await Promise.all(waiting);
  } finally {
    clearTimeout(timer);
  }
  return refs;
}

/**
 * Gives a lookup that is not part of a batch the same kind of ceiling: the
 * answer if it arrives within the batch budget, otherwise the fallback. The
 * lookup itself carries on and its result is simply dropped.
 */
export async function withinBudget<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), BATCH_BUDGET_MS);
  });
  try {
    return await Promise.race([work.catch(() => fallback), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Looks one up in a resolved map, with a placeholder for an id that was never resolved. */
export function refOf(refs: Map<string, UserRef>, id: string): UserRef {
  return refs.get(id) ?? { userId: id, name: null, avatarUrl: null, inServer: false };
}
