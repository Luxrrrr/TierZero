import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildFeature,
  GuildVerificationLevel,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
  type GuildTextBasedChannel,
  type MessageActionRowComponentBuilder,
  type PartialGuildMember,
  type RepliableInteraction,
  type User,
} from "discord.js";
import { customId, defineModule, isRoleAssignable, s, type Infer, type ModuleContext, type ReplyValues } from "@tier0/core";
import { JoinWindow } from "./raid.js";
import { makePlan, type Choice, type Round, type RoundType } from "./rounds.js";
import {
  ChallengeBook,
  accountAge,
  matchesAnswer,
  pressOutcome,
  questionReady,
  timeoutDelay,
} from "./logic.js";
import {
  KICKED_DM,
  RAID_ENDED,
  RAID_STARTED,
  LABELS,
  LOG_FAILED,
  LOG_KICKED,
  LOG_PASSED,
  METHOD_VARIABLE,
  DM_MESSAGE,
  POST_MESSAGE,
  REASON_VARIABLE,
  REPLIES,
  SHARED_VARIABLES,
  replyField,
  type ReasonKey,
  type ReplyKey,
} from "./messages.js";

type Member = GuildMember | PartialGuildMember;
type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
type Method = string;

const START = customId("verification", "start");

const settingsSchema = s.object({
  ignoreBots: s.boolean({
    label: "Leave bots out",
    help: "Bots that join are not given the unverified role and are never removed for not verifying.",
    default: true,
  }),
  roles: s.object(
    {
      verified: s.role({
        label: "Verified role",
        help: "Given when a member passes. Use it to open the channels new members should not see yet.",
        assigns: true,
        optional: true,
        essential: true,
        guided: true,
      }),
      unverified: s.role({
        label: "Unverified role",
        help: "Given when someone joins and taken away once they pass. Leave empty if hiding channels behind the verified role is enough.",
        assigns: true,
        optional: true,
      }),
    },
    { label: "Roles" },
  ),
  check: s.object(
    {
      method: s.choice({
        label: "How members verify",
        options: [
          { value: "button", label: "Press a button", description: "One click. Keeps out anything that cannot press buttons." },
          { value: "captcha", label: "Captcha", description: "A few quick rounds with no images: press the right picture, count, order things, or type a code drawn in squares." },
          { value: "question", label: "Answer a question", description: "They answer a question you write, such as one about the rules." },
        ],
        default: "button",
        guided: true,
      }),
      rounds: s.integer({
        label: "Rounds",
        help: "How many quick rounds a member does. Getting one wrong ends the attempt, and they start again from the first with new ones.",
        default: 3,
        min: 1,
        max: 5,
        guided: true,
        when: { field: "method", equals: "captcha" },
      }),
      roundTypes: s.array(
        s.choice({
          options: [
            { value: "pictures", label: "Press the picture", description: "They press the button with the picture they are told." },
            { value: "count", label: "Count them", description: "They count some pictures and press the number." },
            { value: "odd", label: "Odd one out", description: "One button is different from the rest." },
            { value: "belong", label: "Which does not belong", description: "Three buttons are alike and one is not." },
            { value: "order", label: "Smallest to biggest", description: "They press three pictures in order of size." },
            { value: "typed", label: "A small puzzle", description: "A sum, or a word to type backwards." },
            { value: "block", label: "Code in squares", description: "A code drawn in coloured squares. Leave it out if members use screen readers." },
          ],
        }),
        {
          label: "Kinds of round",
          help: "Each member's rounds are picked from these at random.",
          min: 1,
          unique: true,
          default: ["pictures", "count", "odd", "belong", "order", "typed", "block"],
          layout: "rows",
          when: { field: "method", equals: "captcha" },
        },
      ),
      question: s.string({
        label: "Question",
        help: "Shown to the member before they answer.",
        default: "",
        max: 500,
        multiline: true,
        guided: true,
        when: { field: "method", equals: "question" },
      }),
      answers: s.array(s.string({ max: 100 }), {
        label: "Accepted answers",
        help: "Any one of these passes. Capitals, accents and extra spaces are ignored.",
        unique: true,
        guided: true,
        item: "answer",
        when: { field: "method", equals: "question" },
      }),
      maxAttempts: s.integer({
        label: "Tries allowed",
        help: "How many wrong answers a member gets before the next setting applies. Pressing the verify button cannot be wrong, so this only matters for the captcha and the question.",
        default: 3,
        min: 1,
        max: 10,
      }),
      afterTries: s.choice({
        label: "When the tries run out",
        options: [
          { value: "lockout", label: "Lock them out for a while", description: "They cannot try again until the lockout ends." },
          { value: "kick", label: "Remove them from the server", description: "They can join again and start over." },
        ],
        default: "lockout",
      }),
      lockoutLength: s.duration({
        label: "Lockout length",
        default: "10m",
        min: "1m",
        max: "7d",
        when: { field: "afterTries", equals: "lockout" },
      }),
    },
    {
      label: "The check",
      // The captcha used to be a code to type.
      upgrade: (stored) => (stored.method === "code" ? { ...stored, method: "captcha" } : stored),
    },
  ),
  post: s.object(
    {
      where: s.array(
        s.choice({
          options: [
            { value: "channel", label: "A channel", description: "A message with a verify button that everyone who joins can see." },
            { value: "dm", label: "A direct message", description: "The bot messages each new member the button. Members with direct messages closed cannot verify this way." },
          ],
        }),
        {
          label: "Where members verify",
          help: "Pick both so a member with closed direct messages can still use the channel.",
          min: 1,
          unique: true,
          default: ["dm"],
          guided: true,
        },
      ),
      channel: s.channel({
        types: ["text"],
        optional: true,
        guided: true,
        label: "Channel for the verification message",
        when: { field: "where", includes: "channel", hide: true },
        help: "Use Post the verification message above, or /verification post in Discord, to put the message there. Doing it again edits the message instead of posting a second one.",
      }),
      message: s.message({
        label: "Verification message",
        note: "The verify button is added under this message for you.",
        starting: POST_MESSAGE,
        variables: [...SHARED_VARIABLES, { name: "role", description: "The name of the verified role", sample: "Verified" }],
        components: false,
        when: { field: "where", includes: "channel", hide: true },
      }),
      dmMessage: s.message({
        label: "Direct message to new members",
        help: "Sent to each member as they join.",
        note: "The verify button is added under this message for you.",
        starting: DM_MESSAGE,
        variables: [...SHARED_VARIABLES, { name: "role", description: "The name of the verified role", sample: "Verified" }],
        delivery: "dm",
        components: false,
        audience: "dm",
        when: { field: "where", includes: "dm", hide: true },
      }),
    },
    { label: "Verification message" },
  ),
  newMembers: s.object(
    {
      minAccountAge: s.duration({
        label: "Minimum account age",
        help: "Accounts newer than this cannot verify. Leave empty for no minimum.",
        optional: true,
        max: "365d",
      }),
      youngAction: s.choice({
        label: "A younger account is",
        options: [
          { value: "hold", label: "Held back", description: "They join, but cannot verify until the account is old enough." },
          { value: "kick", label: "Removed", description: "Removed from the server as soon as they join." },
        ],
        default: "hold",
        when: { field: "minAccountAge" },
      }),
      timeoutAction: s.choice({
        label: "A member who never verifies",
        options: [
          { value: "nothing", label: "Is left alone" },
          { value: "kick", label: "Is removed after a wait", description: "Only members who joined while this feature was on." },
        ],
        default: "nothing",
      }),
      timeout: s.duration({
        label: "How long they get",
        default: "1d",
        min: "1m",
        max: "28d",
        when: { field: "timeoutAction", equals: "kick" },
      }),
      sendDm: s.boolean({ default: false, label: "Tell a removed member why by direct message" }),
      kickedDm: s.message({
        label: "Direct message to a removed member",
        help: "Sent just before the bot removes someone, if they allow DMs.",
        starting: KICKED_DM,
        variables: [...SHARED_VARIABLES, REASON_VARIABLE],
        delivery: "dm",
        components: false,
        compact: true,
        audience: "dm",
        when: { field: "sendDm", equals: true },
      }),
    },
    { label: "New members" },
  ),
  raid: s.object(
    {
      enabled: s.boolean({
        label: "Turn on raid protection",
        help: "When many people join at once, the bot uses Discord's own protections until things calm down, then puts everything back.",
        default: false,
      }),
      joins: s.integer({
        label: "People joining that counts as a raid",
        default: 10,
        min: 3,
        max: 200,
      }),
      within: s.duration({
        label: "Within",
        help: "How short a time those people have to join in.",
        default: "1m",
        min: "10s",
        max: "10m",
      }),
      raiseLevel: s.boolean({
        label: "Require phone-verified accounts",
        help: "Raises the server's verification level to Very High, which only lets in accounts with a verified phone number. Bots have to pay for each one.",
        default: true,
      }),
      pauseInvites: s.boolean({
        label: "Pause invites",
        help: "Stops anyone joining through an invite link while it lasts. Members already in are not affected.",
        default: true,
      }),
      lastsFor: s.duration({
        label: "How long it lasts",
        help: "Then the verification level and invites go back to how they were.",
        default: "30m",
        min: "1m",
        max: "24h",
      }),
      channel: s.channel({
        types: ["text"],
        optional: true,
        label: "Channel to tell",
        help: "Where the bot says raid protection started and ended. Left empty, it says nothing.",
      }),
      started: s.message({
        label: "Raid protection started",
        help: "Posted in the channel above.",
        starting: RAID_STARTED,
        variables: [
          ...SHARED_VARIABLES,
          { name: "joins", description: "How many people joined in the window", sample: "14" },
          { name: "ends", description: "When protection ends, as a time that counts down", sample: "in 30 minutes" },
        ],
        components: false,
        compact: true,
        audience: "public",
        when: { field: "channel" },
      }),
      ended: s.message({
        label: "Raid protection ended",
        help: "Posted in the channel above.",
        starting: RAID_ENDED,
        variables: SHARED_VARIABLES,
        components: false,
        compact: true,
        audience: "public",
        when: { field: "channel" },
      }),
    },
    { label: "Raid protection" },
  ),
  log: s.object(
    {
      channel: s.channel({
        types: ["text"],
        optional: true,
        label: "Log channel",
        help: "Where passes, failures and removals are posted. Left empty, nothing is posted.",
      }),
      passed: s.message({
        label: "A member verified",
        help: "Posted in the log channel when someone passes.",
        starting: LOG_PASSED,
        variables: [...SHARED_VARIABLES, METHOD_VARIABLE],
        components: false,
        compact: true,
        audience: "public",
        when: { field: "channel" },
      }),
      failed: s.message({
        label: "A member ran out of tries",
        help: "Posted in the log channel when someone uses every try and is locked out.",
        starting: LOG_FAILED,
        variables: SHARED_VARIABLES,
        components: false,
        compact: true,
        audience: "public",
        when: { field: "channel" },
      }),
      removed: s.message({
        label: "A member was removed",
        help: "Posted in the log channel when the bot removes someone for not verifying, being too new or running out of tries.",
        starting: LOG_KICKED,
        variables: [...SHARED_VARIABLES, REASON_VARIABLE],
        components: false,
        compact: true,
        audience: "public",
        when: { field: "channel" },
      }),
    },
    { label: "Log channel" },
  ),
  replies: s.object(
    {
      passed: replyField("passed"),
      alreadyVerified: replyField("alreadyVerified"),
      notSetUp: replyField("notSetUp"),
      roleTooHigh: replyField("roleTooHigh"),
      roleFailed: replyField("roleFailed"),
      tooYoung: replyField("tooYoung"),
      roundPictures: replyField("roundPictures"),
      roundCount: replyField("roundCount"),
      roundOdd: replyField("roundOdd"),
      roundBelong: replyField("roundBelong"),
      roundOrder: replyField("roundOrder"),
      roundTyped: replyField("roundTyped"),
      roundBlock: replyField("roundBlock"),
      questionPrompt: replyField("questionPrompt"),
      wrongAnswer: replyField("wrongAnswer"),
      codeExpired: replyField("codeExpired"),
      lockedOut: replyField("lockedOut"),
      removed: replyField("removed"),
      notAllowed: replyField("notAllowed"),
      noChannel: replyField("noChannel"),
      postFailed: replyField("postFailed"),
      posted: replyField("posted"),
      updated: replyField("updated"),
      reverifySent: replyField("reverifySent"),
      reverifyNoDm: replyField("reverifyNoDm"),
      reverifyFailed: replyField("reverifyFailed"),
    },
    {
      label: "Replies and errors",
      help: "What the bot says to members and moderators, including when it has to refuse. Open one to reword it.",
      collapsible: true,
    },
  ),
  labels: s.object(
    {
      verifyButton: s.string({ label: "Verify button", default: LABELS.verifyButton, max: 80 }),
      answerButton: s.string({ label: "Button to type an answer", default: LABELS.answerButton, max: 80 }),
      modalTitle: s.string({ label: "Title of the box members type in", default: LABELS.modalTitle, max: 45 }),
      answerLabel: s.string({ label: "Label of the answer box", default: LABELS.answerLabel, max: 45 }),
      reasonTimeout: s.string({
        label: "Reason for removing someone who never verified",
        help: "Written to the audit log, and used as {reason} in messages.",
        default: LABELS.reasonTimeout,
        max: 512,
      }),
      reasonYoung: s.string({
        label: "Reason for removing a new account",
        help: "Written to the audit log, and used as {reason} in messages.",
        default: LABELS.reasonYoung,
        max: 512,
      }),
      reasonAttempts: s.string({
        label: "Reason for removing someone who ran out of tries",
        help: "Written to the audit log, and used as {reason} in messages.",
        default: LABELS.reasonAttempts,
        max: 512,
      }),
    },
    { label: "Labels and text", help: "Button and box text, and the reasons given for removing someone.", collapsible: true },
  ),
});

type Settings = Infer<typeof settingsSchema>;
type Ctx = ModuleContext<Settings>;

const book = new ChallengeBook();
const keyOf = (guildId: string, userId: string): string => `${guildId}:${userId}`;

const stamp = (ms: number): string => `<t:${Math.ceil(ms / 1000)}:R>`;

function valuesFor(ctx: Ctx, user: User): ReplyValues {
  return { user: `<@${user.id}>`, username: user.username, server: ctx.guild.name, role: roleName(ctx) };
}

function roleName(ctx: Ctx): string {
  const id = ctx.settings.roles.verified;
  return (id && ctx.guild.roles.cache.get(id)?.name) || "the verified role";
}

async function tell(ctx: Ctx, interaction: RepliableInteraction, key: ReplyKey, extra: ReplyValues = {}): Promise<void> {
  await ctx.reply(interaction, ctx.settings.replies[key], { ...valuesFor(ctx, interaction.user), ...extra }, { fallback: REPLIES[key].starting });
}

function isConfigured(settings: Settings): boolean {
  if (!settings.roles.verified) return false;
  return settings.check.method !== "question" || questionReady(settings.check.question, settings.check.answers);
}

type Grant = "ok" | "missing" | "tooHigh" | "failed";

async function grantRole(ctx: Ctx, member: GuildMember, roleId: string): Promise<Grant> {
  if (member.roles.cache.has(roleId)) return "ok";
  const role = ctx.guild.roles.cache.get(roleId);
  if (!role) return "missing";
  if (!isRoleAssignable(role.position, ctx.guild.members.me?.roles.highest.position ?? 0)) {
    console.warn(`[verification] cannot assign role ${role.name} in ${ctx.guild.name}: above the bot's own role`);
    return "tooHigh";
  }
  return member.roles.add(role).then(
    () => "ok" as const,
    (error: unknown) => {
      console.warn(`[verification] failed to assign role ${role.name} in ${ctx.guild.name}:`, error);
      return "failed" as const;
    },
  );
}

async function dropUnverified(ctx: Ctx, member: GuildMember): Promise<void> {
  const id = ctx.settings.roles.unverified;
  if (!id || !member.roles.cache.has(id)) return;
  await member.roles.remove(id).catch((error: unknown) => {
    console.warn(`[verification] failed to remove the unverified role in ${ctx.guild.name}:`, error);
  });
}

/** Takes the verified role back and starts the wait again, as if the member had just joined. */
async function resetMember(ctx: Ctx, member: GuildMember): Promise<boolean> {
  const { verified, unverified } = ctx.settings.roles;
  if (!verified) return false;
  const role = ctx.guild.roles.cache.get(verified);
  if (role && member.roles.cache.has(verified)) {
    if (!isRoleAssignable(role.position, ctx.guild.members.me?.roles.highest.position ?? 0)) return false;
    const removed = await member.roles.remove(role).then(() => true, () => false);
    if (!removed) return false;
  }
  if (unverified) await grantRole(ctx, member, unverified);
  book.clear(keyOf(ctx.guild.id, member.id));
  const { newMembers } = ctx.settings;
  const delay = timeoutDelay(newMembers.timeoutAction, newMembers.timeout);
  if (delay !== null) await ctx.tasks.reschedule("kickUnverified", new Date(Date.now() + delay), { userId: member.id });
  return true;
}

async function logTo(
  ctx: Ctx,
  key: "passed" | "failed" | "removed",
  starting: typeof LOG_PASSED,
  user: User,
  extra: ReplyValues = {},
): Promise<void> {
  const channelId = ctx.settings.log.channel;
  if (!channelId) return;
  const channel = ctx.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;
  await ctx.send(channel, ctx.settings.log[key], { ...valuesFor(ctx, user), ...extra }, { fallback: starting, mentions: { users: [], roles: [] } });
}

/** Resolves to whether the member is gone. */
async function removeMember(ctx: Ctx, member: GuildMember, why: ReasonKey): Promise<boolean> {
  const reason = ctx.settings.labels[why];
  if (!member.kickable) {
    console.warn(`[verification] cannot remove ${member.user.username} from ${ctx.guild.name}: the bot's role is not above theirs`);
    return false;
  }
  if (ctx.settings.newMembers.sendDm) {
    await ctx.send(member.user, ctx.settings.newMembers.kickedDm, { ...valuesFor(ctx, member.user), reason }, { fallback: KICKED_DM });
  }
  const gone = await member.kick(reason).then(
    () => true,
    (error: unknown) => {
      console.warn(`[verification] failed to remove ${member.user.username} from ${ctx.guild.name}:`, error);
      return false;
    },
  );
  if (gone) await logTo(ctx, "removed", LOG_KICKED, member.user, { reason });
  return gone;
}

/** Gives the verified role and tidies up after the check. */
async function pass(ctx: Ctx, member: GuildMember, method: Method): Promise<Grant> {
  const verified = ctx.settings.roles.verified;
  if (!verified) return "missing";
  const grant = await grantRole(ctx, member, verified);
  if (grant !== "ok") return grant;
  book.clear(keyOf(ctx.guild.id, member.id));
  await dropUnverified(ctx, member);
  await ctx.tasks.cancel("kickUnverified", { userId: member.id });
  await logTo(ctx, "passed", LOG_PASSED, member.user, { method });
  return "ok";
}

async function finish(ctx: Ctx, interaction: RepliableInteraction, member: GuildMember, method: Method): Promise<void> {
  const grant = await pass(ctx, member, method);
  if (grant === "ok") await tell(ctx, interaction, "passed");
  else if (grant === "missing") await tell(ctx, interaction, "notSetUp");
  else await tell(ctx, interaction, grant === "tooHigh" ? "roleTooHigh" : "roleFailed");
}

/**
 * A button in a direct message has no server to belong to, so its id names
 * one. The one in the channel keeps the plain id, which is how the bot finds
 * its own post again.
 */
function startRow(ctx: Ctx, inDirectMessage = false): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(inDirectMessage ? customId("verification", "start", ctx.guild.id) : START).setLabel(ctx.settings.labels.verifyButton).setStyle(ButtonStyle.Success),
  );
}

function enterRow(ctx: Ctx): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId("verification", "enter", ctx.guild.id)).setLabel(ctx.settings.labels.answerButton).setStyle(ButtonStyle.Primary),
  );
}

const CHOICES_PER_ROW = 3;

/** The buttons of a round. The id carries a random token, never what the button shows or whether it is right. */
function choiceRows(ctx: Ctx, choices: Choice[], pressed: readonly string[] = []): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < choices.length; i += CHOICES_PER_ROW) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        choices.slice(i, i + CHOICES_PER_ROW).map((choice) => {
          const done = pressed.includes(choice.token);
          const button = new ButtonBuilder()
            .setCustomId(customId("verification", "pick", `${ctx.guild.id}:${choice.token}`))
            .setStyle(done ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(done);
          if (choice.emoji) button.setEmoji(choice.emoji);
          if (choice.label) button.setLabel(choice.label);
          return button;
        }),
      ),
    );
  }
  return rows;
}

const ROUND_REPLY: Record<Round["type"], ReplyKey> = {
  pictures: "roundPictures",
  count: "roundCount",
  odd: "roundOdd",
  belong: "roundBelong",
  order: "roundOrder",
  typed: "roundTyped",
  block: "roundBlock",
  question: "questionPrompt",
};

/** Shows the round the member is on, in place of whatever the reply held, with the buttons it needs. */
async function present(ctx: Ctx, interaction: RepliableInteraction, user: User): Promise<void> {
  const running = book.running(keyOf(ctx.guild.id, user.id));
  if (!running) return;
  const { round } = running;
  const key = ROUND_REPLY[round.type];
  const values: ReplyValues = {
    ...valuesFor(ctx, user),
    round: String(running.step + 1),
    rounds: String(running.total),
    ...("values" in round ? round.values : {}),
    ...(round.type === "question" ? { question: ctx.settings.check.question } : {}),
  };
  const shown = await ctx.reply(interaction, ctx.settings.replies[key], values, { fallback: REPLIES[key].starting });
  // Replies carry no buttons of the module's own, so the ones that answer are added to the reply just sent.
  const components = "choices" in round ? choiceRows(ctx, round.choices, running.pressed) : [enterRow(ctx)];
  if (shown) await interaction.editReply({ components }).catch(() => {});
}

/** Whatever was on the reply is over, so its buttons go. */
const clearButtons = (interaction: RepliableInteraction) => interaction.editReply({ components: [] }).catch(() => {});

type PostResult = "posted" | "updated" | "failed";

/**
 * Edits the verification message in its channel, or posts it. The bot finds its
 * own earlier post by the button it carries rather than by a stored id, so there
 * is nothing to go stale, and extra copies in that channel are removed.
 */
async function publish(ctx: Ctx, channel: GuildTextBasedChannel): Promise<PostResult> {
  const me = ctx.client.user?.id;
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const mine = recent
    ? [...recent.values()].filter(
        (message) =>
          message.author.id === me &&
          message.components.some((row) => "components" in row && row.components.some((part) => "customId" in part && part.customId === START)),
      )
    : [];
  const [current, ...extra] = mine;
  for (const message of extra) await message.delete().catch(() => {});

  const values = { server: ctx.guild.name, role: roleName(ctx) };
  const options = { fallback: POST_MESSAGE, rows: [startRow(ctx)] };
  if (current) {
    // Falling through to a new post here would leave two live buttons over a message that cannot be built.
    return (await ctx.edit(current, ctx.settings.post.message, values, options)) ? "updated" : "failed";
  }
  return (await ctx.send(channel, ctx.settings.post.message, values, options)) ? "posted" : "failed";
}

function answerModal(ctx: Ctx): ModalBuilder {
  const { labels } = ctx.settings;
  return new ModalBuilder()
    .setCustomId(customId("verification", "submit", ctx.guild.id))
    .setTitle(labels.modalTitle)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("answer")
          .setLabel(labels.answerLabel)
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(100)
          .setRequired(true),
      ),
    );
}

/** What happens after an answer has been checked, whichever way it was given. */
async function settle(
  ctx: Ctx,
  interaction: RepliableInteraction,
  member: GuildMember,
  result: ReturnType<ChallengeBook["answer"]>,
  method: Method,
): Promise<void> {
  const { check } = ctx.settings;
  const key = keyOf(ctx.guild.id, member.id);
  switch (result.outcome) {
    case "next":
      await present(ctx, interaction, member.user);
      return;
    case "more": {
      const running = book.running(key);
      if (running && "choices" in running.round) await interaction.editReply({ components: choiceRows(ctx, running.round.choices, result.pressed) }).catch(() => {});
      return;
    }
    case "correct":
      await finish(ctx, interaction, member, method);
      break;
    case "wrong":
      await tell(ctx, interaction, "wrongAnswer", { left: result.left });
      break;
    case "expired":
      await tell(ctx, interaction, "codeExpired");
      break;
    case "locked":
      await tell(ctx, interaction, "lockedOut", { until: stamp(result.until) });
      break;
    case "exhausted": {
      if (check.afterTries === "kick" && (await removeMember(ctx, member, "reasonAttempts"))) {
        await tell(ctx, interaction, "removed");
        break;
      }
      const until = book.lock(key, check.lockoutLength);
      await logTo(ctx, "failed", LOG_FAILED, member.user);
      await tell(ctx, interaction, "lockedOut", { until: stamp(until) });
      break;
    }
  }
  await clearButtons(interaction);
}

const matchersFor = (ctx: Ctx) => ({ question: (text: string) => matchesAnswer(text, ctx.settings.check.answers) });

/** What each server in raid protection changed, so it can be put back. */
const raids = new Map<string, RaidChanges>();
const joins = new JoinWindow();

interface RaidChanges {
  /** The verification level to go back to, when the bot raised it. */
  level: number | null;
  invites: boolean;
}

async function tellRaid(ctx: Ctx, key: "started" | "ended", starting: typeof RAID_STARTED, values: ReplyValues): Promise<void> {
  const channelId = ctx.settings.raid.channel;
  const channel = channelId ? ctx.guild.channels.cache.get(channelId) : undefined;
  if (!channel?.isTextBased()) return;
  await ctx.send(channel, ctx.settings.raid[key], { server: ctx.guild.name, ...values }, { fallback: starting, mentions: { users: [], roles: [] } });
}

type RaidStart = "started" | "already" | "nothing" | "failed";

/** Turns on Discord's own protections. Whatever it changes is remembered, and put back when the time is up. */
async function startRaid(ctx: Ctx): Promise<RaidStart> {
  const { guild } = ctx;
  const { raid } = ctx.settings;
  if (raids.has(guild.id)) return "already";

  const changes: RaidChanges = { level: null, invites: false };
  let failed = false;
  const note = (what: string) => (error: unknown) => {
    console.warn(`[verification] could not ${what} in ${guild.name}:`, error);
    failed = true;
    return false;
  };

  if (raid.raiseLevel && guild.verificationLevel < GuildVerificationLevel.VeryHigh) {
    const before = guild.verificationLevel;
    if (await guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, "Raid protection").then(() => true, note("raise the verification level"))) {
      changes.level = before;
    }
  }
  if (raid.pauseInvites && !guild.features.includes(GuildFeature.InvitesDisabled)) {
    if (await guild.disableInvites(true).then(() => true, note("pause invites"))) changes.invites = true;
  }
  // Both already as strict as they would be made: nothing to do, and nothing to put back.
  if (changes.level === null && !changes.invites) return failed ? "failed" : "nothing";

  raids.set(guild.id, changes);
  const until = Date.now() + raid.lastsFor;
  await ctx.tasks.reschedule("raidEnd", new Date(until), { level: changes.level, invites: changes.invites });
  await tellRaid(ctx, "started", RAID_STARTED, { joins: String(joins.count(guild.id, Date.now(), raid.within)), ends: stamp(until) });
  return "started";
}

async function endRaid(ctx: Ctx, changes: RaidChanges): Promise<void> {
  const { guild } = ctx;
  // A level the owner has changed since is theirs now, so only the one the bot set is put back.
  if (changes.level !== null && guild.verificationLevel === GuildVerificationLevel.VeryHigh) {
    await guild.setVerificationLevel(changes.level, "Raid protection ended").catch((error: unknown) => {
      console.warn(`[verification] could not restore the verification level in ${guild.name}:`, error);
    });
  }
  if (changes.invites) {
    await guild.disableInvites(false).catch((error: unknown) => {
      console.warn(`[verification] could not resume invites in ${guild.name}:`, error);
    });
  }
  raids.delete(guild.id);
  await tellRaid(ctx, "ended", RAID_ENDED, {});
}

const skipped = (ctx: Ctx, member: Member): boolean => ctx.settings.ignoreBots && member.user.bot === true;

export default defineModule({
  id: "verification",
  name: "Verification",
  summary: "Keeps new members out until they pass a check.",
  category: "members",

  settings: settingsSchema,

  actions: {
    raidStart: {
      label: "Start raid protection now",
      help: "Does what happens when a raid is spotted: raises the verification level and pauses invites, until the time set under Raid protection is up. Needs the bot to have Manage Server.",
      async run({ ctx }) {
        const result = await startRaid(ctx);
        if (result === "started") return { ok: true, message: "Raid protection is on." };
        if (result === "already") return { ok: true, message: "Raid protection is already on." };
        if (result === "nothing") return { ok: true, message: "Nothing to change: the server is already as strict as this would make it." };
        return { ok: false, message: "Could not change the server. Check that the bot has the Manage Server permission." };
      },
    },
    raidEnd: {
      label: "End raid protection now",
      help: "Puts the verification level and invites back to how they were.",
      async run({ ctx }) {
        const changes = raids.get(ctx.guild.id);
        if (!changes) return { ok: false, message: "Raid protection is not on. If the bot restarted while it was, it ends by itself when the time is up." };
        await ctx.tasks.cancel("raidEnd");
        await endRaid(ctx, changes);
        return { ok: true, message: "Raid protection is off." };
      },
    },
    post: {
      label: "Post the verification message",
      help: "Puts the message with its verify button in the channel above, or updates it if it is already there.",
      async run({ ctx }) {
        const channelId = ctx.settings.post.channel;
        const channel = channelId ? ctx.guild.channels.cache.get(channelId) : undefined;
        if (!channel?.isTextBased()) return { ok: false, message: "Pick a channel for the verification message and save first." };
        if (!isConfigured(ctx.settings)) return { ok: false, message: "Choose the verified role and save first." };
        const result = await publish(ctx, channel);
        if (result === "failed") return { ok: false, message: `Could not post in #${channel.name}. Check that the bot can send messages and embed links there.` };
        return { ok: true, message: result === "posted" ? `Posted in #${channel.name}.` : `Updated the message in #${channel.name}.` };
      },
    },
  },

  commands: [
    {
      name: "verification",
      description: "Post the verification message, or make a member verify again.",
      build: () =>
        new SlashCommandBuilder()
          .setName("verification")
          .setDescription("Post the verification message, or make a member verify again.")
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
          .addSubcommand((sub) => sub.setName("post").setDescription("Post the verification message, or update it if it is already posted."))
          .addSubcommand((sub) =>
            sub
              .setName("send")
              .setDescription("Make a member verify again and send them the verification message.")
              .addUserOption((option) => option.setName("user").setDescription("The member who has to verify.").setRequired(true)),
          ),
      async run(interaction, ctx) {
        const sub = interaction.options.getSubcommand();
        if (sub !== "post" && sub !== "send") return;
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await tell(ctx, interaction, "notAllowed");
          return;
        }
        if (sub === "send") {
          if (!isConfigured(ctx.settings)) {
            await tell(ctx, interaction, "notSetUp");
            return;
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const user = interaction.options.getUser("user", true);
          const target = await ctx.guild.members.fetch(user.id).catch(() => null);
          if (!target || target.user.bot || !(await resetMember(ctx, target))) {
            await tell(ctx, interaction, "reverifyFailed", { target: `<@${user.id}>` });
            return;
          }
          const sent = await ctx.send(target.user, ctx.settings.post.dmMessage, valuesFor(ctx, target.user), {
            fallback: DM_MESSAGE,
            rows: [startRow(ctx, true)],
          });
          await tell(ctx, interaction, sent ? "reverifySent" : "reverifyNoDm", { target: `<@${user.id}>` });
          return;
        }
        const channelId = ctx.settings.post.channel;
        const channel = channelId ? ctx.guild.channels.cache.get(channelId) : undefined;
        if (!channel?.isTextBased()) {
          await tell(ctx, interaction, "noChannel");
          return;
        }
        if (!isConfigured(ctx.settings)) {
          await tell(ctx, interaction, "notSetUp");
          return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await publish(ctx, channel);
        if (result === "failed") await tell(ctx, interaction, "postFailed");
        else await tell(ctx, interaction, result, { channel: `<#${channel.id}>` });
      },
    },
  ],

  events: {
    async memberJoin(member, ctx) {
      if (ctx.settings.raid.enabled && !member.user.bot) {
        const recent = joins.record(ctx.guild.id, Date.now(), ctx.settings.raid.within);
        if (recent >= ctx.settings.raid.joins) await startRaid(ctx);
      }
      if (skipped(ctx, member)) return;
      const { roles, newMembers } = ctx.settings;
      if (!roles.verified || member.roles.cache.has(roles.verified)) return;

      const age = accountAge(member.user.createdTimestamp, Date.now(), newMembers.minAccountAge, newMembers.youngAction);
      if (age.kind === "kick") {
        await removeMember(ctx, member, "reasonYoung");
        return;
      }

      if (roles.unverified) await grantRole(ctx, member, roles.unverified);

      const delay = timeoutDelay(newMembers.timeoutAction, newMembers.timeout);
      if (delay !== null) await ctx.tasks.reschedule("kickUnverified", new Date(Date.now() + delay), { userId: member.id });

      // A closed direct message is logged by ctx.send and goes no further; the channel is the way round it.
      if (ctx.settings.post.where.includes("dm")) {
        await ctx.send(member.user, ctx.settings.post.dmMessage, valuesFor(ctx, member.user), {
          fallback: DM_MESSAGE,
          rows: [startRow(ctx, true)],
        });
      }
    },

    async memberLeave(member, ctx) {
      book.clear(keyOf(ctx.guild.id, member.id));
      await ctx.tasks.cancel("kickUnverified", { userId: member.id });
    },

    // A moderator who hands out the verified role by hand ends the wait too.
    async memberUpdate(_before, after, ctx) {
      const { verified, unverified } = ctx.settings.roles;
      if (!verified || !after.roles.cache.has(verified)) return;
      if (!unverified || !after.roles.cache.has(unverified)) return;
      await dropUnverified(ctx, after);
      await ctx.tasks.cancel("kickUnverified", { userId: after.id });
    },
  },

  tasks: {
    async raidEnd(payload, ctx) {
      const changes: RaidChanges = {
        level: typeof payload.level === "number" ? payload.level : null,
        invites: payload.invites === true,
      };
      await endRaid(ctx, changes);
    },

    async kickUnverified(payload, ctx) {
      const { roles, newMembers } = ctx.settings;
      if (!roles.verified || newMembers.timeoutAction !== "kick") return;
      const member = await ctx.guild.members.fetch(String(payload.userId)).catch(() => null);
      if (!member || member.roles.cache.has(roles.verified)) return;
      await removeMember(ctx, member, "reasonTimeout");
    },
  },

  directMessage: ["start", "enter", "pick", "submit"],

  components: {
    async start(interaction, { ctx }) {
      if (!interaction.isButton()) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const member = await ctx.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) {
        await tell(ctx, interaction, "notSetUp");
        return;
      }

      const { roles, check, newMembers } = ctx.settings;
      const key = keyOf(ctx.guild.id, member.id);
      const age = accountAge(member.user.createdTimestamp, Date.now(), newMembers.minAccountAge, "hold");
      const lockedUntil = book.lockedUntil(key);
      const outcome = pressOutcome({
        configured: isConfigured(ctx.settings),
        verified: roles.verified !== undefined && member.roles.cache.has(roles.verified),
        tooYoung: age.kind !== "ok",
        locked: lockedUntil !== null,
        method: check.method,
      });

      switch (outcome) {
        case "notSetUp":
        case "alreadyVerified":
          await tell(ctx, interaction, outcome);
          return;
        case "tooYoung":
          await tell(ctx, interaction, "tooYoung", { canVerify: age.kind === "ok" ? "" : stamp(age.oldEnoughAt) });
          return;
        case "locked":
          await tell(ctx, interaction, "lockedOut", { until: stamp(lockedUntil ?? Date.now()) });
          return;
        case "pass":
          await finish(ctx, interaction, member, "button");
          return;
        case "challenge": {
          const rounds: Round[] = check.method === "captcha" ? makePlan(check.roundTypes as RoundType[], check.rounds) : [{ type: "question" }];
          book.issue(key, rounds);
          await present(ctx, interaction, member.user);
          return;
        }
      }
    },

    async enter(interaction, { ctx }) {
      if (!interaction.isButton()) return;
      const key = keyOf(ctx.guild.id, interaction.user.id);
      const lockedUntil = book.lockedUntil(key);
      if (lockedUntil !== null) {
        await tell(ctx, interaction, "lockedOut", { until: stamp(lockedUntil) });
        return;
      }
      if (ctx.settings.check.method === "button" || !book.active(key)) {
        await tell(ctx, interaction, "codeExpired");
        return;
      }
      await interaction.showModal(answerModal(ctx));
    },

    async pick(interaction, { rest, ctx }) {
      if (!interaction.isButton()) return;
      await interaction.deferUpdate();
      const member = await ctx.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;
      const { roles, check } = ctx.settings;
      if (roles.verified && member.roles.cache.has(roles.verified)) return;

      const token = rest.split(":")[1] ?? "";
      const result = book.answer(keyOf(ctx.guild.id, member.id), { kind: "token", token }, check.maxAttempts, matchersFor(ctx));
      await settle(ctx, interaction, member, result, "captcha");
    },
  },

  modals: {
    async submit(interaction, { ctx }) {
      // From a button on the reply, the next round replaces it in place; from anywhere else it is a new reply.
      if (interaction.isFromMessage()) await interaction.deferUpdate();
      else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const member = await ctx.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) return;
      const { roles, check } = ctx.settings;
      if (roles.verified && member.roles.cache.has(roles.verified)) {
        await tell(ctx, interaction, "alreadyVerified");
        return;
      }

      const text = interaction.fields.getTextInputValue("answer");
      const result = book.answer(keyOf(ctx.guild.id, member.id), { kind: "text", text }, check.maxAttempts, matchersFor(ctx));
      await settle(ctx, interaction, member, result, check.method);
    },
  },

  async notices(ctx) {
    const { roles, post, raid } = ctx.settings;
    if (raids.has(ctx.guild.id)) return [{ tone: "attention", text: "Raid protection is on. Use End raid protection now to stop it early." }];
    if (raid.enabled && !ctx.guild.members.me?.permissions.has("ManageGuild")) {
      return [{ tone: "attention", text: "Raid protection needs the bot to have the Manage Server permission, which it does not have here." }];
    }
    if (!roles.verified) return [];
    if (!post.where.includes("channel")) {
      return [{ tone: "info", text: "New members get a direct message with the verify button. One with direct messages closed cannot verify, so add a channel as well if that matters." }];
    }
    if (!post.channel) {
      return [{ tone: "attention", text: "Pick a channel for the verification message, save, then use Post the verification message." }];
    }
    return [{ tone: "info", text: "After changing the message here, save and use Post the verification message to update it." }];
  },

  async onDisable(ctx) {
    await ctx.tasks.cancel("kickUnverified");
    // A raid in progress would otherwise leave the server's level and invites as the bot changed them.
    const changes = raids.get(ctx.guild.id);
    if (changes) {
      await ctx.tasks.cancel("raidEnd");
      await endRaid(ctx, changes);
    }
  },

  requires: ["ManageRoles", "KickMembers"],
});
