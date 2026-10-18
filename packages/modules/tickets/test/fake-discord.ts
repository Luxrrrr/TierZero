import type { MessageBody } from "@tier0/core";

/**
 * Just enough of a Discord server for the ticket handlers to run against:
 * channels that keep their messages and permission overwrites, members with
 * roles, and a context that records what the module sent. Plain objects, so a
 * test reads what happened straight off them.
 */

export const GUILD = "100000000000000020";
export const BOT = "100000000000000099";

let next = 900000000000000000n;
export const snowflake = () => String(next++);

export interface FakeUser {
  id: string;
  bot: boolean;
  username: string;
  globalName: string | null;
  tag: string;
  displayAvatarURL(): string;
}

export function user(id: string, username: string, bot = false): FakeUser {
  return { id, bot, username, globalName: null, tag: `${username}#0`, displayAvatarURL: () => `https://cdn.example/${id}.png` };
}

export interface FakeMessage {
  id: string;
  channelId: string;
  author: FakeUser;
  member: { displayName: string; roles: { cache: Map<string, unknown> }; permissions: { has(flag: unknown): boolean } } | null;
  content: string;
  attachments: Map<string, { name: string; url: string; contentType: string | null; size: number }>;
  embeds: { title?: string | null; description?: string | null }[];
  createdAt: Date;
  createdTimestamp: number;
  editedAt: Date | null;
  partial: false;
  components: { toJSON(): unknown }[];
  body?: MessageBody;
  values?: Record<string, string | number>;
  options?: Record<string, unknown>;
  edit(payload: unknown): Promise<FakeMessage>;
}

export function message(channelId: string, author: FakeUser, content: string, roleIds: string[] = []): FakeMessage {
  const at = new Date();
  const self: FakeMessage = {
    id: snowflake(),
    channelId,
    author,
    member: author.bot
      ? null
      : { displayName: author.username, roles: { cache: new Map(roleIds.map((id) => [id, {}])) }, permissions: { has: () => false } },
    content,
    attachments: new Map(),
    embeds: [],
    createdAt: at,
    createdTimestamp: at.getTime(),
    editedAt: null,
    partial: false,
    components: [],
    async edit(payload) {
      self.options = { ...(self.options ?? {}), edited: payload };
      return self;
    },
  };
  return self;
}

export interface Overwrite {
  id: string;
  type: number;
  allow?: unknown;
  deny?: unknown;
  edits: Record<string, boolean | null>;
}

export interface FakeChannel {
  id: string;
  type: number;
  name: string;
  parentId: string | null;
  topic?: string;
  deleted: string[];
  locked?: boolean;
  archived?: boolean;
  sent: FakeMessage[];
  members: { cache: Map<string, unknown>; add(id: string): Promise<void>; remove(id: string): Promise<void> };
  permissionOverwrites: {
    cache: Map<string, Overwrite>;
    edit(id: string, options: Record<string, boolean | null>, extra?: { type?: number }): Promise<void>;
    delete(id: string): Promise<void>;
  };
  messages: { fetch(arg?: unknown): Promise<unknown>; delete(id: string): Promise<void> };
  threads: { create(options: { name: string }): Promise<FakeChannel> };
  parent?: FakeChannel | null;
  webhooks: "denied" | "allowed";
  webhookSent: Record<string, unknown>[];
  isTextBased(): boolean;
  setTopic(topic: string): Promise<void>;
  setName(name: string): Promise<void>;
  setParent(id: string): Promise<void>;
  setLocked(value: boolean): Promise<void>;
  setArchived(value: boolean): Promise<void>;
  delete(reason?: string): Promise<void>;
  send(payload: { content?: string; allowedMentions?: unknown }): Promise<FakeMessage>;
  fetchWebhooks(): Promise<{ find(fn: unknown): unknown }>;
  createWebhook(options: { name: string }): Promise<unknown>;
}

export const TEXT = 0;
export const CATEGORY = 4;
export const PRIVATE_THREAD = 12;

/** Every channel and thread made, so a thread the module created can be fetched like Discord would. */
export const known = new Map<string, FakeChannel>();

export function channel(id: string, options: { type?: number; name?: string; parentId?: string | null } = {}): FakeChannel {
  const overwrites = new Map<string, Overwrite>();
  const threadMembers = new Map<string, unknown>();
  const self: FakeChannel = {
    id,
    type: options.type ?? TEXT,
    name: options.name ?? `channel-${id.slice(-4)}`,
    parentId: options.parentId ?? null,
    deleted: [],
    sent: [],
    webhooks: "allowed",
    webhookSent: [],
    members: {
      cache: threadMembers,
      add: async (userId) => void threadMembers.set(userId, {}),
      remove: async (userId) => void threadMembers.delete(userId),
    },
    permissionOverwrites: {
      cache: overwrites,
      async edit(target, edit, extra) {
        const current = overwrites.get(target) ?? { id: target, type: extra?.type ?? 1, edits: {} };
        current.edits = { ...current.edits, ...edit };
        overwrites.set(target, current);
      },
      async delete(target) {
        overwrites.delete(target);
      },
    },
    messages: {
      async fetch(arg) {
        const wanted = typeof arg === "string" ? arg : typeof arg === "object" && arg !== null && "message" in arg ? String((arg as { message: unknown }).message) : null;
        if (wanted !== null) {
          const found = self.sent.find((m) => m.id === wanted);
          if (!found) throw Object.assign(new Error("Unknown Message"), { code: 10008 });
          return found;
        }
        const list = [...self.sent].reverse();
        const map = new Map(list.map((m) => [m.id, m]));
        return Object.assign(map, { last: () => list.at(-1) });
      },
      async delete(messageId) {
        self.sent = self.sent.filter((m) => m.id !== messageId);
      },
    },
    threads: {
      async create(created) {
        const thread = channel(snowflake(), { type: PRIVATE_THREAD, name: created.name, parentId: self.id });
        thread.parent = self;
        return thread;
      },
    },
    isTextBased: () => true,
    async setTopic(topic) {
      self.topic = topic;
    },
    async setName(name) {
      self.name = name;
    },
    async setParent(parentId) {
      self.parentId = parentId;
    },
    async setLocked(value) {
      self.locked = value;
    },
    async setArchived(value) {
      self.archived = value;
    },
    async delete(reason) {
      self.deleted.push(reason ?? "");
    },
    async send(payload) {
      const sent = message(self.id, user(BOT, "TierZero", true), payload.content ?? "");
      sent.options = payload as Record<string, unknown>;
      self.sent.push(sent);
      return sent;
    },
    async fetchWebhooks() {
      if (self.webhooks === "denied") throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
      return { find: () => undefined };
    },
    async createWebhook(created) {
      if (self.webhooks === "denied") throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
      return {
        name: created.name,
        owner: { id: BOT },
        send: async (payload: Record<string, unknown>) => {
          self.webhookSent.push(payload);
          const target = typeof payload.threadId === "string" ? payload.threadId : self.id;
          const sent = message(target, user(snowflake(), String(payload.username), true), String(payload.content));
          self.sent.push(sent);
          return sent;
        },
      };
    },
  };
  known.set(id, self);
  return self;
}

export interface FakeMember {
  id: string;
  user: FakeUser;
  displayName: string;
  joinedAt: Date;
  roles: { cache: Map<string, { id: string }> };
  /** Only set for a member the test gives server permissions. */
  permissions?: { has(flag: unknown): boolean };
}

export function member(u: FakeUser, roleIds: string[] = [], permissions?: FakeMember["permissions"]): FakeMember {
  const cache = new Map(roleIds.map((id) => [id, { id }]));
  const roles = Object.assign(cache, { some: (fn: (role: { id: string }) => boolean) => [...cache.values()].some(fn) });
  return { id: u.id, user: u, displayName: u.username, joinedAt: new Date(0), roles: { cache: roles }, ...(permissions ? { permissions } : {}) };
}

export interface Sent {
  target: unknown;
  body: MessageBody;
  values: Record<string, string | number>;
  options: Record<string, unknown>;
  message: FakeMessage | null;
}

export interface Replied {
  interaction: unknown;
  body: MessageBody;
  values: Record<string, string | number>;
  options: Record<string, unknown>;
}

export interface World {
  ctx: never;
  guild: { channels: { cache: Map<string, FakeChannel> }; members: { cache: Map<string, FakeMember> } };
  channels: Map<string, FakeChannel>;
  sent: Sent[];
  replies: Replied[];
  scheduled: { kind: string; at: Date; payload: Record<string, unknown> }[];
  cancelled: { kind: string; match: Record<string, unknown> | undefined }[];
  created: Record<string, unknown>[];
  dms: Map<string, Sent[]>;
  add(c: FakeChannel): FakeChannel;
  addMember(m: FakeMember): FakeMember;
}

const mapWith = <V>(map: Map<string, V>) =>
  Object.assign(map, {
    filter: (fn: (value: V) => boolean) => {
      return new Map([...map].filter(([, value]) => fn(value)));
    },
  });

/** A server with a context the module can run in. `settings` is the parsed ticket settings. */
export function world(
  settings: unknown,
  options: { dashboardUrl?: string; botPermissions?: (flag: unknown) => boolean; refuseCreates?: number; dmClosed?: string[] } = {},
): World {
  const channels = mapWith(new Map<string, FakeChannel>());
  const members = mapWith(new Map<string, FakeMember>());
  const users = new Map<string, FakeUser>();
  const sent: Sent[] = [];
  const replies: Replied[] = [];
  const scheduled: World["scheduled"] = [];
  const cancelled: World["cancelled"] = [];
  const created: Record<string, unknown>[] = [];
  let refusals = options.refuseCreates ?? 0;
  const dms = new Map<string, Sent[]>();
  const botUser = user(BOT, "TierZero", true);

  const guild = {
    id: GUILD,
    name: "Test server",
    roles: { everyone: { id: GUILD }, cache: new Map<string, unknown>() },
    emojis: { cache: new Map<string, unknown>() },
    get memberCount() {
      return members.size;
    },
    channels: {
      cache: channels,
      fetch: async (id: string) => channels.get(id) ?? known.get(id) ?? null,
      create: async (opts: Record<string, unknown>) => {
        created.push(opts);
        if (refusals > 0) {
          refusals -= 1;
          throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
        }
        const made = channel(snowflake(), { name: String(opts.name), parentId: (opts.parent as string) ?? null });
        made.topic = opts.topic as string;
        for (const o of (opts.permissionOverwrites as { id: string; type?: number; allow?: unknown; deny?: unknown }[]) ?? []) {
          made.permissionOverwrites.cache.set(o.id, { id: o.id, type: o.type ?? 0, allow: o.allow, deny: o.deny, edits: {} });
        }
        channels.set(made.id, made);
        return made;
      },
    },
    members: {
      me: { id: BOT, permissions: { has: options.botPermissions ?? (() => true) } },
      cache: members,
      fetch: async (id?: string) => {
        if (id === undefined) return members;
        const found = members.get(id);
        if (!found) throw new Error("Unknown Member");
        return found;
      },
      search: async ({ query }: { query: string }) => {
        const wanted = query.toLowerCase();
        return new Map([...members].filter(([, m]) => m.displayName.toLowerCase().startsWith(wanted) || m.user.username.toLowerCase().startsWith(wanted)));
      },
    },
  };

  const record = async (target: unknown, body: MessageBody, values: Record<string, string | number> = {}, opts: Record<string, unknown> = {}) => {
    const t = target as Partial<FakeChannel> & Partial<FakeUser>;
    let msg: FakeMessage | null = null;
    if (t.sent && t.id) {
      msg = message(t.id, botUser, String(body.content ?? ""));
      msg.body = body;
      msg.values = values;
      msg.options = opts;
      t.sent.push(msg);
    } else if (t.username !== undefined && t.id) {
      // A member with direct messages closed: Discord refuses, and the module is told nothing was sent.
      if (options.dmClosed?.includes(t.id)) return null;
      msg = message(snowflake(), botUser, "");
      for (const file of (opts.files as { name: string }[] | undefined) ?? []) {
        msg.attachments.set(file.name, { name: file.name, url: "", contentType: null, size: 0 });
      }
      msg.body = body;
      msg.values = values;
      msg.options = opts;
      const list = dms.get(t.id) ?? [];
      list.push({ target, body, values, options: opts, message: msg });
      dms.set(t.id, list);
    }
    sent.push({ target, body, values, options: opts, message: msg });
    return msg;
  };

  const ctx = {
    client: {
      user: botUser,
      users: {
        cache: users,
        fetch: async (id: string) => {
          const found = members.get(id)?.user ?? users.get(id);
          if (!found) throw new Error("Unknown User");
          return found;
        },
      },
    },
    guild,
    settings,
    tasks: {
      schedule: async (kind: string, at: Date, payload: Record<string, unknown> = {}) => void scheduled.push({ kind, at, payload }),
      reschedule: async (kind: string, at: Date, payload: Record<string, unknown> = {}) => {
        const text = JSON.stringify(payload);
        const found = scheduled.find((task) => task.kind === kind && JSON.stringify(task.payload) === text);
        if (found) found.at = at;
        else scheduled.push({ kind, at, payload });
      },
      cancel: async (kind: string, match?: Record<string, unknown>) => {
        cancelled.push({ kind, match });
        return 0;
      },
    },
    send: record,
    edit: async (msg: FakeMessage, body: MessageBody, values: Record<string, string | number> = {}, opts: Record<string, unknown> = {}) => {
      msg.body = body;
      msg.values = values;
      // Like Discord, an edit keeps only the buttons it is given.
      msg.options = { ...(msg.options ?? {}), ...opts, rows: opts.rows };
      return msg;
    },
    reply: async (interaction: unknown, body: MessageBody, values: Record<string, string | number> = {}, opts: Record<string, unknown> = {}) => {
      replies.push({ interaction, body, values, options: opts });
      const i = interaction as { replied?: boolean; lastReply?: FakeMessage; channelId?: string };
      i.replied = true;
      const msg = message(i.channelId ?? snowflake(), botUser, String(body.content ?? ""));
      msg.body = body;
      msg.values = values;
      i.lastReply = msg;
      const target = i.channelId ? channels.get(i.channelId) : undefined;
      if (target && opts.ephemeral === false) target.sent.push(msg);
      return true;
    },
    dashboardUrl: async () => options.dashboardUrl ?? "",
  };

  return {
    ctx: ctx as never,
    guild: guild as never,
    channels,
    sent,
    replies,
    scheduled,
    cancelled,
    created,
    dms,
    add(c) {
      channels.set(c.id, c);
      return c;
    },
    addMember(m) {
      members.set(m.id, m);
      users.set(m.id, m.user);
      return m;
    },
  };
}

export interface FakeInteraction {
  user: FakeUser;
  member: { roles: string[] } | null;
  memberPermissions: { has(flag: unknown): boolean } | null;
  channelId: string;
  replied: boolean;
  deferred: boolean;
  lastReply?: FakeMessage;
  modals: unknown[];
  values: string[];
  message: FakeMessage | null;
  options: {
    getSubcommand(): string;
    getString(name: string, required?: boolean): string | null;
    getUser(name: string, required?: boolean): FakeUser | null;
  };
  fields: { getTextInputValue(id: string): string };
  deferReply(options?: unknown): Promise<void>;
  deleteReply(): Promise<void>;
  deferUpdate(): Promise<void>;
  showModal(modal: { toJSON(): unknown }): Promise<void>;
  fetchReply(): Promise<FakeMessage | undefined>;
  isMessageComponent(): boolean;
  isStringSelectMenu(): boolean;
}

/** A button press, command or form from one person. */
export function interaction(
  who: FakeUser,
  options: {
    channelId?: string;
    roles?: string[];
    manager?: boolean;
    sub?: string;
    strings?: Record<string, string>;
    users?: Record<string, FakeUser>;
    fields?: Record<string, string>;
    values?: string[];
    component?: boolean;
    /** The message a button was pressed on, such as a direct message the module sent. */
    message?: FakeMessage;
  } = {},
): FakeInteraction {
  const self: FakeInteraction = {
    user: who,
    member: { roles: options.roles ?? [] },
    memberPermissions: { has: () => options.manager === true },
    channelId: options.channelId ?? snowflake(),
    replied: false,
    deferred: false,
    modals: [],
    values: options.values ?? [],
    message: options.message ?? message("0", user(BOT, "TierZero", true), ""),
    options: {
      getSubcommand: () => options.sub ?? "",
      getString: (name) => options.strings?.[name] ?? null,
      getUser: (name) => options.users?.[name] ?? null,
    },
    fields: { getTextInputValue: (id) => options.fields?.[id] ?? "" },
    async deferReply() {
      self.deferred = true;
    },
    async deleteReply() {},
    async deferUpdate() {
      self.deferred = true;
    },
    async showModal(modal) {
      self.modals.push(modal.toJSON());
    },
    async fetchReply() {
      return self.lastReply;
    },
    isMessageComponent: () => options.component !== false,
    isStringSelectMenu: () => (options.values ?? []).length > 0,
  };
  return self;
}
