import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyVariables, embedReply, REPLY_COLOR, type MessageBody, type ReplyKind } from "@tier0/core";
import moderation from "../dist/index.js";
import { moderationSettingsWith } from "./settings-helper.ts";
import { ActionRefused, checkActorMayAct, checkBanDuration, checkReason, checkTargetIdentity, checkTimeoutDuration, discordFailureCode, outcomeNoteKeys, outcomeNotes } from "../dist/action-rules.js";
import { DEFAULT_WORDING, REPLIES, defaultBody, refusalSentence } from "../dist/texts.js";
import { historyList } from "../dist/history-list.js";
import { actionLabel, describeLength, moderatorName, noticeValues } from "../dist/modlog.js";
import { replyRefusal, say } from "../dist/reply.js";

/**
 * Every sentence and word below is what the module said before any of it could
 * be changed, copied out by hand. A default that drifts from it fails here.
 */
const WAS_SAID: Record<string, Record<string, string>> = {
  refusals: {
    reasonRequired: "This server requires a reason for moderation actions.",
    reasonTooLong: "A reason can be at most {max} characters.",
    durationUnreadableTimeout: "Duration must look like 10m, 2h or 7d.",
    durationUnreadableBan: "Duration must look like 1d or 7d.",
    timeoutTooLong: "Timeouts cannot be longer than 28 days, which is Discord's own limit.",
    banTooLong: "A temporary ban can last at most {maxDays} days. Leave the duration unset for a permanent ban.",
    targetSelf: "You cannot take a moderation action against yourself.",
    targetBot: "The bot cannot take a moderation action against itself.",
    targetOwner: "The server owner cannot be actioned.",
    noPermission: "You are not allowed to {action} here. You need the matching Discord permission, or a place on this server's staff list at a level that allows it.",
    notInServer: "You need to be a member of this server to take moderation actions here, because the bot compares your roles with theirs.",
    actorRank: "You cannot action someone with a role equal to or higher than your own.",
    botRank: "My highest role is not above theirs, so Discord won't let me do that.",
    notAMember: "That user is not a member of this server.",
    lookupFailed: "Could not check that member. Try again.",
    actionInProgress: "Another action on this member is in progress. Try again in a moment.",
    alreadyBanned: "{name} is already banned. Use /unban first to change it.",
    notBanned: "{name} is not banned.",
    cannotActOn: "I cannot {verb}. They may be an administrator, my role may not be above theirs, or I may lack the permission.",
    discordFailedRank: "I could not {verb}. Check that my role is above theirs.{correctionNote}",
    discordFailedPermission: "I could not {verb}. Check my permissions.{correctionNote}",
  },
  staff: {
    notStaff: "Only moderators on this server's staff list can use this. Ask the server owner to add you on the Access tab of the dashboard.",
    needsAdmin: "You need to be an admin to {action}. A moderator can warn and time members out.",
    menuNotAMember: "That message was not sent by a server member, so there is nobody to act on.",
    menuSelf: "You cannot take an action on yourself.",
    menuBot: "That is this bot. There is nothing to do.",
    menuOutOfDate: "That form is out of date. Open the menu again.",
  },
  lookups: {
    caseNotFound: "There is no case #{number}.",
    noHistory: "{user} has no recorded history.",
  },
  purge: {
    purgeNeedsPermission: "You need the Manage Messages permission to delete messages.",
    purgeWrongChannel: "This command only works in a server text channel.",
    purgeNothingEligible: "None of those messages can be bulk deleted: Discord only allows deleting messages sent in the last 14 days.",
    purgeFailed: "I could not delete those messages. Check my permissions in this channel.",
  },
  confirmations: {
    timeoutCleared: "Cleared {user}'s timeout. Case #{case}.",
    contextWarned: "Warned {name}. Case #{case}.{notes}",
    contextTimedOut: "Timed out {name} until {until}. Case #{case}.{notes}",
    contextKicked: "Kicked {name}. Case #{case}.{notes}",
    contextBanned: "Banned {name}.{expiry} Case #{case}.{notes}",
  },
  direct: {
    correction: "Correction: the message you were just sent about being {action} was sent in error. Nothing happened to you.",
  },
  // Added with /lockdown, so these are what it said when it was first written.
  raid: {
    lockdownStarted: "Locked {count}.{skippedNote}",
    lockdownEnded: "Unlocked {count}.{skippedNote}",
    lockdownNothingLocked: "No channel is locked by the bot.",
    lockdownNothingToLock: "There is nothing to lock: those channels are already locked, left alone by the settings, or hidden from members.",
    lockdownNeedsPermission: "I need the Manage Roles permission to lock channels.",
    lockdownNotAllowed: "You need the Manage Channels permission, or to be an admin on this server's staff list, to lock or unlock channels.",
  },
};

/** The colour each default has, written out so changing one is a decision and not an accident. */
const KIND_OF = (group: string, key: string): ReplyKind => {
  if (group === "confirmations") return "success";
  if (group === "direct") return "warning";
  if (key === "lockdownStarted" || key === "lockdownEnded") return "success";
  if (key === "noHistory" || key === "purgeNothingEligible" || key === "lockdownNothingLocked" || key === "lockdownNothingToLock") return "info";
  return "error";
};

const LABELS_WERE: Record<string, Record<string, string>> = {
  actions: {
    warned: "Warned",
    timedOut: "Timed out",
    timeoutCleared: "Timeout cleared",
    kicked: "Kicked",
    banned: "Banned",
    unbanned: "Unbanned",
    automodWarn: "Automod warn",
    automodTimeout: "Automod timeout",
    automodDelete: "Automod message delete",
    automodOther: "Automod {kind}",
    automod: "Automod",
    noReason: "No reason given",
    memberFallback: "the member",
    memberFallbackStart: "That member",
  },
  abilities: { warn: "warn members", timeout: "time members out", timeoutClear: "clear timeouts", kick: "kick members", ban: "ban members", unban: "lift bans" },
  verbs: { timeout: "time that member out", timeoutClear: "clear that timeout", kick: "kick that member", ban: "ban that member", unban: "lift that ban" },
  notes: {
    reasonNote: "Reason: {reason}",
    expiryNote: "This expires {when}.",
    banExpires: "It expires {when}.",
    warnNotInServer: "They are not in the server, so the warning is on their record only.",
    banNotInServer: "They are not in the server, so the ban stops them from joining again.",
    dmWithheld: "They are not in the server, so they were not sent a direct message.",
    dmFailed: "They could not be sent a direct message, most likely because they do not accept messages from the bot.",
    modLogMissing: "The mod log channel no longer exists, so nothing was posted. Choose another in the Moderation settings.",
    modLogFailed: "The mod log post failed. Check that the bot can send messages in the mod log channel.",
    correctionSent: "They had already been sent a message about it, so they were sent a correction.",
    correctionFailed: "They had already been sent a message about it and the correction could not be delivered.",
    raidLocked: "Locked {count}.",
    appealRetry: "You can appeal again {when}.",
    warningNote: "This is warning {n}.",
    appealNote: "You can appeal this ban with the button below.",
    liftedNote: "Your restriction in this server was lifted.",
    evidenceOne: "Message",
    evidenceMany: "Messages",
    evidenceMoreOne: "and {n} more message",
    evidenceMoreMany: "and {n} more messages",
    evidenceDeleted: "(deleted)",
    evidenceAttachments: "Attachments: {names}",
    evidenceNoText: "(no text)",
  },
  time: {
    dayOne: "{n} day",
    dayMany: "{n} days",
    hourOne: "{n} hour",
    hourMany: "{n} hours",
    minuteOne: "{n} minute",
    minuteMany: "{n} minutes",
    secondOne: "{n} second",
    secondMany: "{n} seconds",
  },
  history: {
    line: "**#{case}** {action}{reversed} - {reason} - {date}",
    reversed: "(reversed)",
    caseReversed: "This action has since been reversed.",
    more: "...and {count} more.",
  },
  counts: {
    messageOne: "{count} message",
    messageMany: "{count} messages",
    skippedOne: "{count} message was left because it is older than 14 days.",
    skippedMany: "{count} messages were left because they are older than 14 days.",
    channelOne: "{count} channel",
    channelMany: "{count} channels",
    lockSkipped: "{count} could not be changed, most likely because the bot cannot manage them.",
  },
  menu: {
    menuWarn: "Warn",
    menuTimeout: "Time out",
    menuKick: "Kick",
    menuBan: "Ban",
    modalTitle: "{verb} {name}",
    reasonLabel: "Reason",
    reasonPlaceholder: "Why",
    reasonPlaceholderMessage: "Why. The member is sent this and the message, which is saved with the case.",
    timeoutLabel: "How long",
    timeoutPlaceholder: "10m, 2h or 7d. Empty uses the server's default.",
    banLabel: "How long (empty is permanent)",
    banPlaceholder: "1d or 7d. Empty is permanent.",
    presetLabel: "Preset",
    presetPlaceholder: "Pick a common reason, or write one below",
    deleteLabel: "Delete the message too",
    deleteYes: "Yes, delete it",
    deleteNo: "No, keep it",
  },
  reasons: {
    tempBanExpired: "Temporary ban expired",
    escalated: "Automatic: {rule} ({warns})",
    appealAccepted: "Ban appeal accepted",
    lockdown: "Lockdown",
    joinAlert: "Many members joined in a short time",
  },
};

describe("defaults are what the module has always said", () => {
  const settings = moderationSettingsWith({}) as unknown as { replies: Record<string, Record<string, MessageBody>>; labels: Record<string, Record<string, string>> };

  test("every reply starts as the old sentence, and none was added or lost", () => {
    for (const [group, messages] of Object.entries(WAS_SAID)) {
      assert.deepEqual(Object.keys(settings.replies[group]!).sort(), Object.keys(messages).sort(), `${group} has the same set of messages`);
      for (const [key, text] of Object.entries(messages)) {
        assert.deepEqual(settings.replies[group]![key], embedReply(text, KIND_OF(group, key)), `${group}.${key}`);
        const body = settings.replies[group]![key]!;
        assert.equal(body.content, "", "nothing above the embed");
        assert.equal(body.embeds[0]?.description, text);
        assert.equal(body.embeds[0]?.color, REPLY_COLOR[KIND_OF(group, key)]);
      }
    }
    assert.deepEqual(Object.keys(settings.replies).sort(), Object.keys(WAS_SAID).sort());
  });

  test("every label starts as the old word, and none was added or lost", () => {
    assert.deepEqual(settings.labels, LABELS_WERE);
  });

  test("the code's own fallbacks are the same text as the settings", () => {
    assert.deepEqual(DEFAULT_WORDING, LABELS_WERE);
    for (const [group, messages] of Object.entries(WAS_SAID)) {
      for (const [key, text] of Object.entries(messages)) {
        assert.deepEqual(defaultBody(group as keyof typeof REPLIES, key), embedReply(text, KIND_OF(group, key)));
      }
    }
  });

  test("the dashboard keeps its own sentences where they differ", () => {
    assert.equal(refusalSentence("alreadyBanned", { name: "sam" }, "dashboard"), "sam is already banned. Lift the ban first to change it.");
    assert.equal(
      refusalSentence("botRank", {}, "dashboard"),
      "The bot's highest role is not above theirs, so Discord will not let it do that. Move the bot's role higher in the server's role settings.",
    );
    assert.equal(
      refusalSentence("cannotActOn", { verb: "ban that member" }, "dashboard"),
      "The bot cannot ban that member. They may be an administrator, its role may not be above theirs, or it may lack the permission.",
    );
    assert.equal(
      refusalSentence("discordFailedPermission", { verb: "lift that ban", correctionNote: "" }, "dashboard"),
      "The bot could not lift that ban. Check its permissions.",
    );
  });

  test("a stored legacy value is still read", () => {
    const custom = moderationSettingsWith({ replies: { refusals: { reasonRequired: "Give a reason." } } }) as unknown as { replies: { refusals: { reasonRequired: MessageBody } } };
    assert.equal(custom.replies.refusals.reasonRequired.content, "Give a reason.");
  });

  test("an over-long label is refused rather than stored", () => {
    const resolved = moderation.settings.parse({ labels: { menu: { reasonLabel: "x".repeat(46) } } });
    assert.equal(resolved.ok, false);
  });

  test("a label that names a variable it does not have is refused", () => {
    const resolved = moderation.settings.parse({ labels: { notes: { reasonNote: "Because {why}" } } });
    assert.equal(resolved.ok, false);
  });
});

describe("a refusal carries a code and values, and the dashboard still reads its sentence", () => {
  const refused = (run: () => unknown): ActionRefused => {
    try {
      run();
    } catch (error) {
      assert.ok(error instanceof ActionRefused);
      return error;
    }
    return assert.fail("expected a refusal");
  };

  test("reason checks", () => {
    const tooLong = refused(() => checkReason("x".repeat(501), { requireReason: false }));
    assert.deepEqual([tooLong.status, tooLong.code, tooLong.values], [400, "reasonTooLong", { max: 500 }]);
    assert.equal(tooLong.message, "A reason can be at most 500 characters.");
    const required = refused(() => checkReason(" ", { requireReason: true }));
    assert.deepEqual([required.code, required.message], ["reasonRequired", "This server requires a reason for moderation actions."]);
  });

  test("self, bot and owner share one wording each", () => {
    assert.equal(refused(() => checkTargetIdentity("1", "1", "2", "3")).code, "targetSelf");
    assert.equal(refused(() => checkTargetIdentity("2", "1", "2", "3")).code, "targetBot");
    const owner = refused(() => checkTargetIdentity("3", "1", "2", "3"));
    assert.equal(owner.code, "targetOwner");
    assert.equal(owner.message, "The server owner cannot be actioned.");
  });

  test("duration limits", () => {
    const long = refused(() => checkTimeoutDuration(29 * 86_400_000));
    assert.deepEqual([long.code, long.message], ["timeoutTooLong", "Timeouts cannot be longer than 28 days, which is Discord's own limit."]);
    const ban = refused(() => checkBanDuration(4000 * 86_400_000));
    assert.deepEqual([ban.code, ban.values], ["banTooLong", { maxDays: 3650 }]);
    assert.match(ban.message, /^A temporary ban can last at most 3650 days\./);
  });

  test("permission uses the owner's words for the verb", () => {
    const base = { action: "ban", hasDiscordPermission: false, staffRole: null, isInstanceOwner: false } as const;
    const stock = refused(() => checkActorMayAct(base));
    assert.deepEqual(stock.values, { action: "ban members" });
    const reworded = refused(() => checkActorMayAct(base, { ...DEFAULT_WORDING.abilities, ban: "verbannen" }));
    assert.deepEqual(reworded.values, { action: "verbannen" });
  });

  test("a failed call names the verb and, once messaged, the correction", () => {
    assert.deepEqual(discordFailureCode("kick"), { code: "discordFailedRank", values: { verb: "kick that member" } });
    assert.deepEqual(discordFailureCode("unban"), { code: "discordFailedPermission", values: { verb: "lift that ban" } });
    assert.deepEqual(discordFailureCode("ban", { ...DEFAULT_WORDING.verbs, ban: "verbannen" }).values, { verb: "verbannen" });
  });
});

describe("answering in Discord", () => {
  interface Sent {
    body: MessageBody;
    values: Record<string, unknown>;
    fallback: MessageBody | undefined;
  }

  function stub(stored: Record<string, unknown> = {}, accept = true) {
    const sent: Sent[] = [];
    const raw: unknown[] = [];
    const ctx = {
      settings: moderationSettingsWith(stored),
      reply: async (_i: unknown, body: MessageBody, values: Record<string, unknown>, options?: { fallback?: MessageBody }) => {
        sent.push({ body, values, fallback: options?.fallback });
        return accept;
      },
    } as never;
    const interaction = {
      replied: false,
      deferred: false,
      reply: async (payload: unknown) => {
        raw.push(payload);
      },
    } as never;
    return { ctx, interaction, sent, raw };
  }

  test("sends the owner's message with the stock one to fall back on", async () => {
    const { ctx, interaction, sent } = stub({ replies: { lookups: { caseNotFound: "Nope, no #{number}" } } });
    await say(ctx, interaction, "lookups", "caseNotFound", { number: 9 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.body.content, "Nope, no #{number}");
    assert.deepEqual(sent[0]!.fallback, embedReply("There is no case #{number}.", "error"));
    assert.deepEqual(sent[0]!.values, { number: 9 });
  });

  test("when neither the owner's message nor the stock one can be sent, the stock sentence goes out plainly", async () => {
    const { ctx, interaction, raw } = stub({}, false);
    await say(ctx, interaction, "lookups", "caseNotFound", { number: 9 });
    const last = raw[0] as { embeds: { description: string; color: number }[]; content?: string };
    assert.equal(last.embeds[0]?.description, "There is no case #9.");
    assert.equal(last.embeds[0]?.color, parseInt(REPLY_COLOR.error.slice(1), 16));
    assert.equal(last.content, undefined);
  });

  test("a coded refusal is looked up in the settings, an uncoded one is said as it stands", async () => {
    const coded = stub({ replies: { refusals: { notBanned: "{name} was never banned." } } });
    await replyRefusal(coded.ctx, coded.interaction, new ActionRefused(409, "sam is not banned.", "notBanned", { name: "sam" }));
    assert.equal(coded.sent[0]!.body.content, "{name} was never banned.");
    assert.deepEqual(coded.sent[0]!.values, { name: "sam" });

    const plain = stub();
    await replyRefusal(plain.ctx, plain.interaction, new ActionRefused(400, "One of the messages wasn't sent by this member."));
    assert.equal(plain.sent.length, 0);
    assert.equal((plain.raw[0] as { embeds: { description: string }[] }).embeds[0]?.description, "One of the messages wasn't sent by this member.");
  });

  test("a username that looks like a variable is only a value, never filled in", async () => {
    const { ctx, interaction, sent } = stub();
    await replyRefusal(ctx, interaction, new ActionRefused(409, "x", "notBanned", { name: "{server}" }));
    const text = sent[0]!.body.embeds[0]!.description;
    assert.equal(text, "{name} is not banned.");
    assert.equal(applyVariables(text, { name: "{server}", server: "Home" }), "{server} is not banned.");
  });
});

describe("words used inside other text", () => {
  const words = {
    ...DEFAULT_WORDING,
    actions: { ...DEFAULT_WORDING.actions, warned: "Verwarnt", noReason: "Kein Grund", automod: "Autoregeln" },
    notes: { ...DEFAULT_WORDING.notes, reasonNote: "Grund: {reason}", expiryNote: "Endet {when}." },
    time: { ...DEFAULT_WORDING.time, minuteMany: "{n} Minuten" },
  };

  test("action names, the missing reason and the notes follow the owner's labels", () => {
    assert.equal(actionLabel("warn", words), "Verwarnt");
    assert.equal(actionLabel("automod-warn", words), "Automod warn");
    assert.equal(actionLabel("automod-slowmode", words), "Automod slowmode");
    assert.equal(moderatorName("automod-warn", "9", "9", words), "Autoregeln");
    const at = new Date("2030-01-01T00:00:00.000Z");
    const seconds = Math.floor(at.getTime() / 1000);
    const values = noticeValues({ action: "warn", reason: null, expiresAt: at, durationMs: 600_000 }, words);
    assert.equal(values.action, "verwarnt");
    assert.equal(values.actionTitle, "Verwarnt");
    assert.equal(values.reason, "Kein Grund");
    assert.equal(values.expiryNote, ` Endet <t:${seconds}:R>.`);
    assert.equal(values.duration, "10 Minuten");
    assert.equal(noticeValues({ action: "warn", reason: "Spam", expiresAt: null }, words).reasonNote, " Grund: Spam");
  });

  test("with the stock labels the values are as they were", () => {
    const at = new Date("2030-01-01T00:00:00.000Z");
    const seconds = Math.floor(at.getTime() / 1000);
    const values = noticeValues({ action: "timeout", reason: "Spam", expiresAt: at, durationMs: 90 * 60_000 });
    assert.equal(values.reasonNote, " Reason: Spam");
    assert.equal(values.expiryNote, ` This expires <t:${seconds}:R>.`);
    assert.equal(values.duration, "90 minutes");
    assert.equal(describeLength(1000), "1 second");
    assert.equal(describeLength(3_600_000), "1 hour");
  });

  test("the history list uses the owner's line, reversed tag and closing line", () => {
    const record = (n: number, active: boolean) => ({ caseNumber: n, action: "ban", active, reason: "Raiding", createdAt: new Date("2026-10-01T12:00:00Z") });
    const custom = {
      ...DEFAULT_WORDING,
      history: { ...DEFAULT_WORDING.history, line: "#{case} {action}{reversed}: {reason} ({date})", reversed: "[undone]", more: "+{count} more" },
    };
    const lines = historyList([record(2, true), record(1, false)], 3800, custom).split("\n");
    assert.match(lines[0]!, /^#2 Banned: Raiding \(<t:\d+:d>\)$/);
    assert.match(lines[1]!, /^#1 Banned \[undone\]: Raiding/);

    const many = Array.from({ length: 40 }, (_, i) => record(40 - i, true));
    const cut = historyList(many, 600, custom).split("\n");
    assert.match(cut.at(-1)!, /^\+\d+ more$/);
  });

  test("outcome notes are found by name, so the right wording can be used where they are shown", () => {
    const facts = { action: "ban", dm: "failed", modLog: "missing", targetInServer: false } as const;
    assert.deepEqual(outcomeNoteKeys(facts), ["banNotInServer", "dmFailed", "modLogMissing"]);
    assert.deepEqual(outcomeNotes(facts, { ...DEFAULT_WORDING.notes, dmFailed: "Keine DM." })[1], "Keine DM.");
    assert.equal(outcomeNotes(facts)[0], "They are not in the server, so the ban stops them from joining again.");
  });
});
