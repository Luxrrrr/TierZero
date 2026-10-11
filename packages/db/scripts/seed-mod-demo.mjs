/* global console, process */
/**
 * Fills one server with made-up moderation history so the mod dashboard has
 * something to show: about 60 infractions over the last 45 days across 12
 * pretend members and 4 pretend moderators, plus notes, a few removed entries,
 * audit rows and two staff members.
 *
 *   DATABASE_URL=file:/path/to/tier0.db node packages/db/scripts/seed-mod-demo.mjs <guildId>
 *   DATABASE_URL=file:/path/to/tier0.db node packages/db/scripts/seed-mod-demo.mjs <guildId> --remove
 *
 * The guild must already exist in the database (the bot creates it when it
 * joins). Every reason, note and summary starts with "[demo] ", and every user
 * id is from a fixed list of made-up ones, so --remove deletes exactly what
 * this script added and nothing else. Case numbers continue after the
 * server's current highest. Running it twice without --remove is refused.
 */
import { PrismaClient } from "@prisma/client";

const PREFIX = "[demo] ";
const DAY = 24 * 60 * 60 * 1000;

const MEMBERS = [
  "810000000000000001", "810000000000000002", "810000000000000003", "810000000000000004",
  "810000000000000005", "810000000000000006", "810000000000000007", "810000000000000008",
  "810000000000000009", "810000000000000010", "810000000000000011", "810000000000000012",
];
const MODERATORS = ["820000000000000001", "820000000000000002", "820000000000000003", "820000000000000004"];
const DEMO_OWNER = "830000000000000001";
const FAKE_IDS = [...MEMBERS, ...MODERATORS, DEMO_OWNER];

const MOD_NAMES = {
  [MODERATORS[0]]: "Priya",
  [MODERATORS[1]]: "Marcus",
  [MODERATORS[2]]: "Tamsin",
  [MODERATORS[3]]: "Jonas",
};

const REASONS = {
  warn: [
    "Spamming emoji in general chat",
    "Heated argument after being asked to drop it",
    "Posting an invite link outside the promo channel",
    "Repeated off-topic posts in the help channels",
    "Mild insult towards another member",
    "Ignored the pinned rules about spoilers",
  ],
  timeout: [
    "Continued the argument after a warning",
    "Mass mentions",
    "Flooding voice chat with soundboard clips",
    "Slurs in a screenshot caption",
  ],
  kick: ["Alt account evading a previous timeout", "Advertising a server in DMs"],
  ban: ["Scam links posted to several channels", "Harassment of another member, repeated after final warning"],
  unban: ["Appeal accepted after review"],
};

const NOTES = [
  "Has been helpful in the support channels lately.",
  "Spoke to them in DMs, they understood the warning.",
  "Friend of another member in the server, tends to join arguments. Watch for pile-ons.",
  "Claims the account was compromised. Reset password, no further incidents.",
  "Asked about getting the helper role. Not yet, revisit in a month.",
  "Appeal pending, waiting on a reply from the person who made the original call.",
  "Second offence this month, keep an eye on them.",
  "Reported by two separate members for the same behaviour.",
  "Apologised publicly, no need for further action.",
  "Returning after a break. Fresh start.",
  "Streamer, may bring visitors who do not know the rules.",
  "Spoke in voice, calm and polite. Argument was a misunderstanding.",
  "Possible alt of a previously banned account. Not confirmed.",
  "Regular in the events channel, good with newcomers.",
  "Wrote a long message about the rules being unfair. Replied with the reasoning.",
];

// A small fixed-seed generator so reruns produce the same history.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const prisma = new PrismaClient();

async function remove(guildId) {
  const infractions = await prisma.infraction.findMany({
    where: { guildId, userId: { in: MEMBERS }, reason: { startsWith: PREFIX } },
    select: { id: true },
  });
  const notes = await prisma.modNote.findMany({
    where: { guildId, userId: { in: MEMBERS }, content: { startsWith: PREFIX } },
    select: { id: true },
  });
  const infractionIds = infractions.map((row) => row.id);
  const noteIds = notes.map((row) => row.id);

  const audit = await prisma.modAudit.deleteMany({
    where: {
      guildId,
      OR: [
        { summary: { startsWith: PREFIX }, actorId: { in: FAKE_IDS } },
        { infractionId: { in: infractionIds } },
        { noteId: { in: noteIds } },
      ],
    },
  });
  const removedInfractions = await prisma.infraction.deleteMany({ where: { id: { in: infractionIds } } });
  const removedNotes = await prisma.modNote.deleteMany({ where: { id: { in: noteIds } } });
  const staff = await prisma.staffMember.deleteMany({ where: { guildId, userId: { in: FAKE_IDS } } });

  console.log(
    `Removed ${removedInfractions.count} infractions, ${removedNotes.count} notes, ` +
      `${audit.count} audit rows and ${staff.count} staff rows from guild ${guildId}.`,
  );
}

async function seed(guildId) {
  const existing = await prisma.infraction.count({
    where: { guildId, userId: { in: MEMBERS }, reason: { startsWith: PREFIX } },
  });
  if (existing > 0) {
    throw new Error(`Guild ${guildId} already has demo data. Run with --remove first.`);
  }

  const rand = random(20261009);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const now = Date.now();

  // Members are not equally troublesome: the first few collect most of the cases.
  const weightedMember = () => MEMBERS[Math.floor(Math.pow(rand(), 1.8) * MEMBERS.length)];
  const weightedMod = () => MODERATORS[Math.floor(Math.pow(rand(), 1.4) * MODERATORS.length)];

  const plan = [];
  for (let i = 0; i < 56; i++) {
    const roll = rand();
    const action = roll < 0.5 ? "warn" : roll < 0.78 ? "timeout" : roll < 0.9 ? "kick" : "ban";
    plan.push({
      userId: weightedMember(),
      moderatorId: weightedMod(),
      action,
      // Spread over 45 days, skewed to daytime hours in UTC.
      at: now - rand() * 45 * DAY - 60 * 1000,
    });
  }
  // Three timeouts that are still running.
  for (let i = 0; i < 3; i++) {
    plan.push({
      userId: MEMBERS[i + 3],
      moderatorId: MODERATORS[i % MODERATORS.length],
      action: "timeout",
      at: now - (1 + i * 2) * 60 * 60 * 1000,
      running: true,
    });
  }
  plan.sort((a, b) => a.at - b.at);

  // One unban, following a ban that is placed earlier in the plan.
  const banIndex = plan.findIndex((entry) => entry.action === "ban" && entry.at < now - 10 * DAY);
  if (banIndex >= 0) {
    plan.push({
      userId: plan[banIndex].userId,
      moderatorId: MODERATORS[0],
      action: "unban",
      at: Math.min(now - 2 * DAY, plan[banIndex].at + 7 * DAY),
    });
    plan.sort((a, b) => a.at - b.at);
  }

  const last = await prisma.infraction.aggregate({ where: { guildId }, _max: { caseNumber: true } });
  let caseNumber = last._max.caseNumber ?? 0;

  // Entries that were later taken off the record; warns and timeouts only,
  // which is all staff can remove.
  const voidTargets = new Set();
  const voidable = plan.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.action === "warn" || entry.action === "timeout");
  for (const { index } of voidable.filter(({ entry }) => !entry.running).filter((_, i) => i % 6 === 2)) {
    voidTargets.add(index);
  }

  const created = [];
  const auditRows = [];
  for (const [index, entry] of plan.entries()) {
    caseNumber++;
    const createdAt = new Date(entry.at);
    let expiresAt = null;
    let active = false;
    if (entry.action === "timeout") {
      const hours = entry.running ? 24 : pick([1, 6, 12, 24]);
      expiresAt = new Date(entry.at + (entry.running ? 36 : hours) * 60 * 60 * 1000);
      active = expiresAt.getTime() > now;
    }
    if (entry.action === "ban") {
      active = !plan.some((other) => other.action === "unban" && other.userId === entry.userId && other.at > entry.at);
    }

    const voided = voidTargets.has(index);
    const voidedAt = voided ? new Date(Math.min(now - 60 * 1000, entry.at + 6 * 60 * 60 * 1000)) : null;
    const voidedBy = voided ? MODERATORS[(MODERATORS.indexOf(entry.moderatorId) + 1) % MODERATORS.length] : null;

    const row = await prisma.infraction.create({
      data: {
        guildId,
        userId: entry.userId,
        moderatorId: entry.moderatorId,
        action: entry.action,
        reason: PREFIX + pick(REASONS[entry.action]),
        createdAt,
        expiresAt,
        active: voided ? false : active,
        caseNumber,
        voidedAt,
        voidedBy,
        voidReason: voided ? PREFIX + pick(["Issued to the wrong member", "Resolved in DMs, no longer relevant", "Rule was not clear at the time"]) : null,
      },
    });
    created.push(row);

    if (voided) {
      auditRows.push({
        guildId,
        at: voidedAt,
        actorId: voidedBy,
        actorName: MOD_NAMES[voidedBy],
        actorRole: "mod",
        kind: "infraction.void",
        targetUserId: entry.userId,
        infractionId: row.id,
        noteId: null,
        summary: `${PREFIX}Removed case #${row.caseNumber} (${row.action}) from the record`,
        before: JSON.stringify({ caseNumber: row.caseNumber, action: row.action, reason: row.reason, voided: false }),
        after: JSON.stringify({ voided: true, reason: row.voidReason }),
      });
    }
  }

  // Notes, a couple of them later deleted by an admin.
  let deletedNotes = 0;
  const noteIds = [];
  for (let i = 0; i < NOTES.length; i++) {
    const userId = i < 10 ? MEMBERS[i % 6] : weightedMember();
    const authorId = weightedMod();
    const createdAt = new Date(now - rand() * 40 * DAY);
    const deleted = i === 3 || i === 11;
    const note = await prisma.modNote.create({
      data: {
        guildId,
        userId,
        authorId,
        content: PREFIX + NOTES[i],
        createdAt,
        deletedAt: deleted ? new Date(createdAt.getTime() + DAY) : null,
        deletedBy: deleted ? MODERATORS[0] : null,
      },
    });
    noteIds.push(note.id);
    auditRows.push({
      guildId,
      at: createdAt,
      actorId: authorId,
      actorName: MOD_NAMES[authorId],
      actorRole: "mod",
      kind: "note.add",
      targetUserId: userId,
      infractionId: null,
      noteId: note.id,
      summary: `${PREFIX}Added a note`,
      before: null,
      after: JSON.stringify({ content: note.content }),
    });
    if (deleted) {
      deletedNotes++;
      auditRows.push({
        guildId,
        at: note.deletedAt,
        actorId: MODERATORS[0],
        actorName: MOD_NAMES[MODERATORS[0]],
        actorRole: "admin",
        kind: "note.delete",
        targetUserId: userId,
        infractionId: null,
        noteId: note.id,
        summary: `${PREFIX}Deleted a note`,
        before: JSON.stringify({ content: note.content }),
        after: null,
      });
    }
  }

  // Staff changes made by the pretend owner.
  const staffAt = new Date(now - 40 * DAY);
  await prisma.staffMember.createMany({
    data: [
      { guildId, userId: MODERATORS[0], role: "admin", addedBy: DEMO_OWNER, addedAt: staffAt },
      { guildId, userId: MODERATORS[1], role: "mod", addedBy: DEMO_OWNER, addedAt: staffAt },
    ],
  });
  for (const [userId, role] of [[MODERATORS[0], "admin"], [MODERATORS[1], "mod"]]) {
    auditRows.push({
      guildId,
      at: staffAt,
      actorId: DEMO_OWNER,
      actorName: "Server owner",
      actorRole: "owner",
      kind: "staff.add",
      targetUserId: userId,
      infractionId: null,
      noteId: null,
      summary: `${PREFIX}Added ${MOD_NAMES[userId]} as ${role}`,
      before: null,
      after: JSON.stringify({ role }),
    });
  }

  auditRows.sort((a, b) => a.at - b.at);
  for (const data of auditRows) await prisma.modAudit.create({ data });

  const voidedCount = created.filter((row) => row.voidedAt).length;
  const activeCount = created.filter((row) => row.active).length;
  console.log(
    `Added ${created.length} infractions (cases ${created[0].caseNumber} to ${created.at(-1).caseNumber}, ` +
      `${voidedCount} removed, ${activeCount} still active), ${noteIds.length} notes (${deletedNotes} deleted), ` +
      `${auditRows.length} audit rows and 2 staff members to guild ${guildId}.`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const guildId = args.find((arg) => !arg.startsWith("--"));
  if (!guildId || !/^\d{17,20}$/.test(guildId)) {
    console.error("Usage: seed-mod-demo.mjs <guildId> [--remove]\nA guild id is required; nothing is guessed.");
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild) {
    console.error(`Guild ${guildId} is not in this database. Start the bot in that server first.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Database: ${process.env.DATABASE_URL}`);
  if (args.includes("--remove")) await remove(guildId);
  else await seed(guildId);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
