import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type GuildMember,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
  type RepliableInteraction,
} from "discord.js";
import {
  customId,
  defineModule,
  isRoleAssignable,
  s,
  type Infer,
  type MessageBody,
  type ModuleContext,
  type ReplyValues,
  type RowHooks,
  type RowStatus,
} from "@tier0/core";
import { prisma, type ReactionRoleMenu } from "@tier0/db";
import { parseMapping, serializeMapping, type MenuMapping } from "./mapping.js";
import { computeChange, legacyMenuId, menuSnapshot, upgradeMenus } from "./menus.js";
import {
  ALREADY_HAD_MESSAGE,
  DEFAULT_LABELS,
  DID_NOT_HAVE_MESSAGE,
  GAVE_MESSAGE,
  MENU_MESSAGE,
  MENU_VARIABLES,
  PROBLEMS,
  PUBLISHED_MESSAGE,
  PUBLISHED_VARIABLES,
  REMOVED_MESSAGE,
  TOGGLE_VARIABLES,
  UPDATED_MESSAGE,
  UPDATED_VARIABLES,
  problemField,
  upgradeMenu,
  type ProblemKey,
} from "./messages.js";

const MAX_BUTTONS_PER_ROW = 5;

const BUTTON_STYLE: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

const optionField = s.object({
  emoji: s.emoji({ optional: true, label: "Emoji" }),
  label: s.string({ label: "Label", max: 80 }),
  role: s.role({ label: "Role to give", assigns: true }),
  style: s.choice({
    label: "Button colour",
    help: "Used when members pick with buttons.",
    options: [
      { value: "secondary", label: "Grey" },
      { value: "primary", label: "Blurple" },
      { value: "success", label: "Green" },
      { value: "danger", label: "Red" },
    ],
    default: "secondary",
  }),
  description: s.string({
    label: "Description",
    help: "A second line under the role in a dropdown menu.",
    optional: true,
    max: 100,
  }),
});

/**
 * What a menu says to the member who uses it. Each menu has its own, so a menu
 * for game roles can talk differently from one for community roles. A menu the
 * owner has not reworded says what the defaults do.
 */
const menuReplies = s.object(
  {
      gave: s.message({
        label: "When a role is given",
        help: "Shown after a button gives a role.",
        starting: GAVE_MESSAGE,
        variables: TOGGLE_VARIABLES,
        delivery: "dm",
        components: false,
        compact: true,
        audience: "private",
        note: "Only the member who pressed the button sees this.",
      }),
      removed: s.message({
        label: "When a role is taken away",
        help: "Shown after a button takes a role away.",
        starting: REMOVED_MESSAGE,
        variables: TOGGLE_VARIABLES,
        delivery: "dm",
        components: false,
        compact: true,
        audience: "private",
        note: "Only the member who pressed the button sees this.",
      }),
      alreadyHad: s.message({
        label: "When a member already has the role",
        help: "Shown after a button on a menu that only gives roles is pressed by someone who has the role.",
        starting: ALREADY_HAD_MESSAGE,
        variables: TOGGLE_VARIABLES,
        delivery: "dm",
        components: false,
        compact: true,
        audience: "private",
        note: "Only the member who pressed the button sees this.",
      }),
      didNotHave: s.message({
        label: "When a member does not have the role",
        help: "Shown after a button on a menu that only takes roles away is pressed by someone without the role.",
        starting: DID_NOT_HAVE_MESSAGE,
        variables: TOGGLE_VARIABLES,
        delivery: "dm",
        components: false,
        compact: true,
        audience: "private",
        note: "Only the member who pressed the button sees this.",
      }),
      updated: s.message({
        label: "After a pick from a dropdown",
        help: "Shown after a member picks from a dropdown menu.",
        starting: UPDATED_MESSAGE,
        variables: UPDATED_VARIABLES,
        delivery: "dm",
        components: false,
        compact: true,
        audience: "private",
        note: "Only the member who picked sees this.",
      }),
    optionGone: problemField("optionGone"),
    cannotAssign: problemField("cannotAssign"),
    roleChangeFailed: problemField("roleChangeFailed"),
    needsRole: problemField("needsRole"),
    tooMany: problemField("tooMany"),
    noRoles: s.string({
      label: "No roles left from this menu",
      help: "Fills {roles} in the reply to a dropdown pick when the member has none of the menu's roles left.",
      default: DEFAULT_LABELS.noRoles,
      max: 100,
    }),
  },
  {
    label: "Replies and errors",
    help: "What the bot says to a member who uses this menu, including when it has to refuse. Open one to reword it.",
    collapsible: true,
  },
);

const menuField = s.object(
  {
    name: s.string({ label: "Menu name", help: "Shown to members in the bot's replies, and what /rolemenu is given.", max: 100 }),
    channel: s.channel({ types: ["text"], label: "Channel to post in" }),
    message: s.message({
      label: "Menu message",
      note: "The role buttons or dropdown are added under this message for you.",
      starting: MENU_MESSAGE,
      variables: MENU_VARIABLES,
      components: false,
      attach: {
        kind: "list",
        list: "options",
        label: "label",
        emoji: "emoji",
        style: "style",
        description: "description",
        mode: { field: "kind", menu: "select" },
        placeholder: "placeholder",
        noun: "role",
      },
    }),
    kind: s.choice({
      label: "Members pick with",
      options: [
        { value: "buttons", label: "Buttons", description: "One per role, five to a row." },
        { value: "select", label: "A dropdown menu", description: "Tidier for many roles." },
      ],
      default: "buttons",
    }),
    mode: s.choice({
      label: "What picking a role does",
      options: [
        { value: "toggle", label: "Gives it, or takes it back", description: "Picking a role the member has takes it off again." },
        { value: "give", label: "Only gives it", description: "Picking a role they already have changes nothing. Suits a rules or verify button." },
        { value: "take", label: "Only takes it away", description: "Picking a role they have removes it, and nothing is given. Suits leaving a notification role." },
      ],
      default: "toggle",
    }),
    placeholder: s.string({
      label: "Dropdown placeholder",
      help: "The grey text in the dropdown before anything is picked.",
      default: DEFAULT_LABELS.placeholder,
      max: 150,
      when: { field: "kind", equals: "select" },
    }),
    exclusive: s.boolean({
      default: false,
      label: "Picking one role clears the others",
      help: "Turn this on for menus like platform or rank where only one choice makes sense.",
    }),
    maxPicks: s.integer({
      label: "Most roles a member can have from this menu",
      help: "Leave empty for no limit.",
      optional: true,
      min: 1,
      max: 25,
      when: { field: "exclusive", equals: false },
    }),
    requiredRole: s.role({
      label: "Only members with this role can use it",
      help: "Leave empty to let everyone use the menu.",
      optional: true,
    }),
    options: s.array(optionField, { min: 1, max: 25, label: "Roles" }),
    replies: menuReplies,
    id: s.string({ generated: true }),
  },
  { upgrade: upgradeMenu },
);

type MenuSettings = Infer<typeof menuField>;

const settingsSchema = s.object(
  {
    menus: s.array(menuField, {
      label: "Role menus",
      help: "Post a menu from its row with Post in Discord. Changes reach a posted menu the next time you post it, and removing a menu deletes its post.",
      essential: true,
    }),
    replies: s.object(
      {
        published: s.message({
          label: "After /rolemenu publishes a menu",
          starting: PUBLISHED_MESSAGE,
          variables: PUBLISHED_VARIABLES,
          delivery: "dm",
          components: false,
          compact: true,
          audience: "private",
          note: "Only the moderator who ran the command sees this.",
        }),
        noMenu: problemField("noMenu"),
        channelGone: problemField("channelGone"),
        editFailed: problemField("editFailed"),
        postFailed: problemField("postFailed"),
        inactive: problemField("inactive"),
      },
      {
        label: "Replies and errors",
        help: "What the bot says to members and moderators, including when it has to refuse. Open one to reword it.",
        collapsible: true,
      },
    ),
  },
  { upgrade: upgradeMenus },
);

type RolesSettings = Infer<typeof settingsSchema>;
type Ctx = ModuleContext<RolesSettings>;
type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

const menuIdOf = (menu: { id?: string; name: string }): string => menu.id ?? legacyMenuId(menu.name);

function buildRows(menu: MenuSettings): Row[] {
  const id = menuIdOf(menu);
  if (menu.kind === "select") {
    const most = menu.exclusive ? 1 : Math.min(menu.maxPicks ?? menu.options.length, menu.options.length);
    const select = new StringSelectMenuBuilder()
      .setCustomId(customId("roles", "pick", id))
      .setMinValues(1)
      .setMaxValues(Math.max(1, most))
      .addOptions(
        menu.options.map((option) => {
          const entry: { label: string; value: string; description?: string; emoji?: string } = {
            label: option.label.slice(0, 100),
            value: option.role,
          };
          if (option.description) entry.description = option.description.slice(0, 100);
          if (option.emoji) entry.emoji = option.emoji;
          return entry;
        }),
      );
    if (menu.placeholder.trim() !== "") select.setPlaceholder(menu.placeholder.slice(0, 150));
    return [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select)];
  }

  const rows: Row[] = [];
  for (let i = 0; i < menu.options.length; i += MAX_BUTTONS_PER_ROW) {
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    for (const option of menu.options.slice(i, i + MAX_BUTTONS_PER_ROW)) {
      const button = new ButtonBuilder()
        .setCustomId(customId("roles", "toggle", option.role))
        .setLabel(option.label)
        .setStyle(BUTTON_STYLE[option.style] ?? ButtonStyle.Secondary);
      if (option.emoji) button.setEmoji(option.emoji);
      row.addComponents(button);
    }
    rows.push(row);
  }
  return rows;
}

/** Every stored post of a menu, oldest first. A post made before menus had ids is matched by its name. */
async function postsOf(guildId: string, menuId: string): Promise<ReactionRoleMenu[]> {
  const rows = await prisma.reactionRoleMenu.findMany({ where: { guildId }, orderBy: { id: "asc" } });
  return rows.filter((row) => menuIdOf(parseMapping(row.mapping)) === menuId);
}

async function deletePost(ctx: Ctx, post: ReactionRoleMenu): Promise<void> {
  const channel = ctx.guild.channels.cache.get(post.channelId);
  if (channel?.isTextBased()) await channel.messages.delete(post.messageId).catch(() => {});
  await prisma.reactionRoleMenu.delete({ where: { id: post.id } }).catch(() => {});
}

type PublishResult = { ok: true; updated: boolean; channelId: string } | { ok: false; problem: Exclude<ProblemKey, MenuProblemKey> };

/**
 * Posts a menu, or edits its posted message in place when it is still in the
 * menu's channel. A post left in another channel, or a second post of the
 * same menu, is deleted, so one menu never has two live copies.
 */
async function publishMenu(ctx: Ctx, menu: MenuSettings): Promise<PublishResult> {
  const channel = ctx.guild.channels.cache.get(menu.channel);
  if (!channel || !channel.isTextBased()) return { ok: false, problem: "channelGone" };

  const id = menuIdOf(menu);
  const mapping: MenuMapping = {
    id,
    name: menu.name,
    exclusive: menu.exclusive,
    ...(menu.mode === "give" || menu.mode === "take" ? { mode: menu.mode } : {}),
    options: menu.options.map((option) => ({
      role: option.role,
      label: option.label,
      ...(option.emoji ? { emoji: option.emoji } : {}),
    })),
    ...(menu.maxPicks !== undefined && !menu.exclusive ? { maxPicks: menu.maxPicks } : {}),
    ...(menu.requiredRole ? { requiredRole: menu.requiredRole } : {}),
    snapshot: menuSnapshot(menu as unknown as Record<string, unknown>),
  };
  const values = { menu: menu.name };
  const options = { fallback: MENU_MESSAGE, rows: buildRows(menu) };

  const posts = await postsOf(ctx.guild.id, id);
  const [current, ...extra] = posts;
  for (const post of extra) await deletePost(ctx, post);

  if (current && current.channelId === channel.id) {
    const message = await channel.messages.fetch(current.messageId).catch(() => null);
    if (message) {
      const edited = await ctx.edit(message, menu.message, values, options);
      // Not falling through to a repost: that would delete the live menu over a message that cannot be built.
      if (!edited) return { ok: false, problem: "editFailed" };
      await prisma.reactionRoleMenu.update({ where: { id: current.id }, data: { mapping: serializeMapping(mapping) } });
      return { ok: true, updated: true, channelId: channel.id };
    }
  }
  if (current) await deletePost(ctx, current);

  const posted = await ctx.send(channel, menu.message, values, options);
  if (!posted) return { ok: false, problem: "postFailed" };
  await prisma.reactionRoleMenu.create({
    data: { guildId: ctx.guild.id, channelId: channel.id, messageId: posted.id, mapping: serializeMapping(mapping) },
  });
  return { ok: true, updated: false, channelId: channel.id };
}

const channelName = (ctx: Ctx, id: string): string => {
  const name = ctx.guild.channels.cache.get(id)?.name;
  return name ? `#${name}` : "its channel";
};

async function statusOf(ctx: Ctx, menu: MenuSettings): Promise<RowStatus> {
  const [post] = await postsOf(ctx.guild.id, menuIdOf(menu));
  if (!post) return { tone: "idle", text: "Not posted yet" };

  const channel = ctx.guild.channels.cache.get(post.channelId);
  if (!channel?.isTextBased()) return { tone: "problem", text: "Its channel was deleted. Post it again." };
  const message = await channel.messages.fetch(post.messageId).catch(() => null);
  if (!message) return { tone: "problem", text: `The post in #${channel.name} was deleted or cannot be read. Post it again.` };

  const mapping = parseMapping(post.mapping);
  if (mapping.snapshot === menuSnapshot(menu as unknown as Record<string, unknown>)) {
    return { tone: "ok", text: `Posted in #${channel.name}, up to date` };
  }
  return { tone: "idle", text: `Posted in #${channel.name}. Changed since, post it again to update it.` };
}

const PUBLISH_FAILED: Partial<Record<ProblemKey, string>> = {
  channelGone: "The menu's channel no longer exists. Pick another channel and save.",
  editFailed: "The posted menu could not be edited. Check that the bot can still see that channel and send messages in it.",
  postFailed: "The menu could not be posted. Check that the bot can send messages and embed links in that channel.",
};

const menuRows: RowHooks<RolesSettings> = {
  status: ({ ctx, rows }) => Promise.all(rows.map((ref) => statusOf(ctx, ref.row as unknown as MenuSettings))),
  actions: {
    post: {
      label: "Post in Discord",
      help: "Posts the menu in its channel, or updates the posted one in place.",
      async run({ ctx, row }) {
        const result = await publishMenu(ctx, row.row as unknown as MenuSettings);
        if (!result.ok) return { ok: false, message: PUBLISH_FAILED[result.problem] ?? "The menu could not be posted." };
        const where = channelName(ctx, result.channelId);
        return { ok: true, message: result.updated ? `Updated the menu in ${where}.` : `Posted the menu in ${where}.` };
      },
    },
  },
};

/** The wording of the menu a post was made from, if that menu is still in the settings. A removed menu falls back to the defaults. */
function repliesOf(ctx: Ctx, mapping: MenuMapping): MenuSettings["replies"] | undefined {
  const id = menuIdOf(mapping);
  return ctx.settings.menus.find((menu) => menuIdOf(menu) === id)?.replies;
}

type MenuReplyKey = "gave" | "removed" | "alreadyHad" | "didNotHave" | "updated";
type MenuProblemKey = "optionGone" | "cannotAssign" | "roleChangeFailed" | "needsRole" | "tooMany";

const MENU_REPLY_DEFAULTS: Record<MenuReplyKey, MessageBody> = {
  gave: GAVE_MESSAGE,
  removed: REMOVED_MESSAGE,
  alreadyHad: ALREADY_HAD_MESSAGE,
  didNotHave: DID_NOT_HAVE_MESSAGE,
  updated: UPDATED_MESSAGE,
};

async function say(ctx: Ctx, interaction: RepliableInteraction | MessageComponentInteraction, mapping: MenuMapping, key: MenuReplyKey, values: ReplyValues): Promise<void> {
  await ctx.reply(interaction, repliesOf(ctx, mapping)?.[key] ?? MENU_REPLY_DEFAULTS[key], values, { fallback: MENU_REPLY_DEFAULTS[key] });
}

/** A refusal about a menu is worded by that menu, and one with no menu to name by the settings as a whole. */
async function tell(
  ctx: Ctx,
  interaction: RepliableInteraction | MessageComponentInteraction,
  key: Exclude<ProblemKey, MenuProblemKey>,
  values?: ReplyValues,
): Promise<void>;
async function tell(
  ctx: Ctx,
  interaction: RepliableInteraction | MessageComponentInteraction,
  key: MenuProblemKey,
  values: ReplyValues,
  mapping: MenuMapping,
): Promise<void>;
async function tell(
  ctx: Ctx,
  interaction: RepliableInteraction | MessageComponentInteraction,
  key: ProblemKey,
  values: ReplyValues = {},
  mapping?: MenuMapping,
): Promise<void> {
  const own = mapping && key in MENU_PROBLEM_KEYS ? repliesOf(ctx, mapping)?.[key as MenuProblemKey] : undefined;
  const body = own ?? (key in MENU_PROBLEM_KEYS ? PROBLEMS[key].starting : ctx.settings.replies[key as Exclude<ProblemKey, MenuProblemKey>]);
  await ctx.reply(interaction, body, values, { fallback: PROBLEMS[key].starting });
}

const MENU_PROBLEM_KEYS: Record<MenuProblemKey, true> = { optionGone: true, cannotAssign: true, roleChangeFailed: true, needsRole: true, tooMany: true };

/** Removes, then adds. Resolves to the first role Discord refused, or null. */
async function changeRoles(member: GuildMember, toRemove: string[], toAdd: string[]): Promise<string | null> {
  for (const id of toRemove) {
    if (!(await member.roles.remove(id).then(() => true, () => false))) return id;
  }
  for (const id of toAdd) {
    if (!(await member.roles.add(id).then(() => true, () => false))) return id;
  }
  return null;
}

/** What a press or a pick does, shared by buttons and dropdowns. */
async function applyPick(
  ctx: Ctx,
  interaction: MessageComponentInteraction,
  picked: string[],
  via: "button" | "select",
): Promise<void> {
  const row = await prisma.reactionRoleMenu.findUnique({ where: { messageId: interaction.message.id } });
  if (!row) {
    await tell(ctx, interaction, "inactive");
    return;
  }

  const mapping = parseMapping(row.mapping);
  const menuRoles = mapping.options.map((option) => option.role);
  const valid = picked.filter((id) => menuRoles.includes(id) && ctx.guild.roles.cache.get(id) !== undefined);
  if (valid.length === 0 || (via === "button" && valid.length !== picked.length)) {
    await tell(ctx, interaction, "optionGone", { menu: mapping.name }, mapping);
    return;
  }

  const member = await ctx.guild.members.fetch(interaction.user.id);
  if (mapping.requiredRole && !member.roles.cache.has(mapping.requiredRole)) {
    const required = ctx.guild.roles.cache.get(mapping.requiredRole)?.name ?? mapping.requiredRole;
    await tell(ctx, interaction, "needsRole", { required, menu: mapping.name }, mapping);
    return;
  }

  const current = menuRoles.filter((id) => member.roles.cache.has(id));
  const change = computeChange(valid, {
    current,
    menuRoles,
    exclusive: mapping.exclusive,
    ...(mapping.mode ? { mode: mapping.mode } : {}),
    ...(mapping.maxPicks !== undefined ? { maxPicks: mapping.maxPicks } : {}),
  });
  if (!change.ok) {
    await tell(ctx, interaction, "tooMany", { max: change.max, menu: mapping.name }, mapping);
    return;
  }

  const botHighest = ctx.guild.members.me?.roles.highest.position ?? 0;
  const tooHigh = change.toAdd.map((id) => ctx.guild.roles.cache.get(id)).find((role) => role && !isRoleAssignable(role.position, botHighest));
  if (tooHigh) {
    await tell(ctx, interaction, "cannotAssign", { role: tooHigh.name, menu: mapping.name }, mapping);
    return;
  }

  const failed = await changeRoles(member, change.toRemove, change.toAdd);
  if (failed) {
    await tell(ctx, interaction, "roleChangeFailed", { role: ctx.guild.roles.cache.get(failed)?.name ?? failed, menu: mapping.name }, mapping);
    return;
  }

  if (via === "button") {
    const pressed = valid[0] ?? "";
    const gave = change.toAdd.includes(pressed);
    if (!gave && !change.toRemove.includes(pressed)) {
      const had = mapping.mode !== "take";
      await say(ctx, interaction, mapping, had ? "alreadyHad" : "didNotHave", { role: ctx.guild.roles.cache.get(pressed)?.name ?? pressed, menu: mapping.name });
      return;
    }
    await say(ctx, interaction, mapping, gave ? "gave" : "removed", { role: ctx.guild.roles.cache.get(pressed)?.name ?? pressed, menu: mapping.name });
    return;
  }

  const held = new Set([...current.filter((id) => !change.toRemove.includes(id)), ...change.toAdd]);
  const names = mapping.options.filter((option) => held.has(option.role)).map((option) => ctx.guild.roles.cache.get(option.role)?.name ?? option.label);
  await say(ctx, interaction, mapping, "updated", {
    roles: names.length > 0 ? names.join(", ") : (repliesOf(ctx, mapping)?.noRoles ?? DEFAULT_LABELS.noRoles),
    menu: mapping.name,
  });
}

export default defineModule({
  id: "roles",
  name: "Self-service roles",
  summary: "Role menus with buttons or a dropdown, so members can pick their own roles.",
  category: "members",

  settings: settingsSchema,

  rows: { menus: menuRows },

  commands: [
    {
      name: "rolemenu",
      description: "Publish or refresh a self-service role menu.",
      build: () =>
        new SlashCommandBuilder()
          .setName("rolemenu")
          .setDescription("Publish or refresh a self-service role menu.")
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
          .addStringOption((option) =>
            option
              .setName("name")
              .setDescription("The menu's name, as set on the dashboard.")
              .setRequired(true)
              .setAutocomplete(true),
          ),
      async autocomplete(interaction, ctx) {
        const typed = interaction.options.getFocused().toLowerCase();
        const choices = ctx.settings.menus
          .filter((menu) => menu.name.toLowerCase().includes(typed))
          .slice(0, 25)
          .map((menu) => ({ name: menu.name.slice(0, 100), value: menuIdOf(menu) }));
        await interaction.respond(choices);
      },
      async run(interaction, ctx) {
        const name = interaction.options.getString("name", true);
        const lower = name.toLowerCase();
        // A pick from the suggestions arrives as the menu's id, a typed name as itself.
        const menu =
          ctx.settings.menus.find((candidate) => menuIdOf(candidate) === name) ??
          ctx.settings.menus.find((candidate) => candidate.name === name) ??
          ctx.settings.menus.find((candidate) => candidate.name.toLowerCase() === lower);
        if (!menu) {
          await tell(ctx, interaction, "noMenu", { name });
          return;
        }

        const result = await publishMenu(ctx, menu);
        if (!result.ok) {
          await tell(ctx, interaction, result.problem);
          return;
        }
        await ctx.reply(
          interaction,
          ctx.settings.replies.published,
          { menu: menu.name, menuChannel: `<#${menu.channel}>` },
          { fallback: PUBLISHED_MESSAGE },
        );
      },
    },
  ],

  components: {
    async toggle(interaction, { rest, ctx }) {
      if (!interaction.isButton()) return;
      await applyPick(ctx, interaction, [rest], "button");
    },
    async pick(interaction, { ctx }) {
      if (!interaction.isStringSelectMenu()) return;
      // Answering with the message's own components clears the member's pick
      // from the dropdown, so picking the same role again takes it back off.
      await interaction.update({ components: interaction.message.components }).catch(() => {});
      await applyPick(ctx, interaction, interaction.values, "select");
    },
  },

  async onSettingsChange(ctx, previous) {
    const kept = new Set(ctx.settings.menus.map(menuIdOf));
    for (const menu of previous.menus) {
      const id = menuIdOf(menu);
      if (kept.has(id)) continue;
      for (const post of await postsOf(ctx.guild.id, id)) await deletePost(ctx, post);
    }
  },

  requires: ["ManageRoles"],
});
