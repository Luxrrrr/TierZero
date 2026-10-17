import {
  CATEGORY_CHANNEL_LIMIT,
  type TicketHealthCode,
  type TicketHealthIssue,
  type TicketHealthSummary,
  type TicketPanelOption,
} from "@tier0/core";

/**
 * What the bot found wrong with a server's tickets, in words an owner can act
 * on. The bot only reports codes; every sentence lives here so the Settings
 * tab, the inbox and the tests agree. Free of React so the tests can import
 * it directly.
 */

export interface HealthLine {
  code: TicketHealthCode;
  /** Danger stops members opening tickets; attention is something that works less well. */
  tone: "danger" | "attention";
  title: string;
  detail: string;
  /** Where to fix it in the dashboard, or null when the fix is in Discord itself. */
  fix: { label: string; href: string } | null;
  /** The panel and type the fix is in, so the settings page can open them rather than only scroll to Panels. */
  target: SettingsTarget | null;
}

/** A panel, and maybe one of its types, to open on the settings page. */
export interface SettingsTarget {
  panelId: string;
  typeId: string | null;
}

const ROW_ID = /^[A-Za-z0-9_-]{1,32}$/;

/** The address of the settings page with a panel or a type to open, which the page reads once it loads. */
export function settingsTargetHref(guildId: string, target: SettingsTarget | null): string {
  if (!target) return settingsHref(guildId, "panels");
  const query = new URLSearchParams({ panel: target.panelId });
  if (target.typeId) query.set("type", target.typeId);
  return `/guilds/${guildId}/tickets/settings?${query.toString()}#section-panels`;
}

/** The panel and type a settings address names, as `settingsTargetHref` writes them, or null. */
export function readSettingsTarget(search: string): SettingsTarget | null {
  const query = new URLSearchParams(search);
  const panelId = query.get("panel");
  if (!panelId || !ROW_ID.test(panelId)) return null;
  const typeId = query.get("type");
  return { panelId, typeId: typeId && ROW_ID.test(typeId) ? typeId : null };
}

/**
 * Where a panel and a type sit in the settings draft, by position, which is
 * how the form addresses the rows of its lists. Null when the panel is gone.
 */
export function targetIndexes(
  target: SettingsTarget,
  panels: readonly { id: string; types: readonly { id: string }[] }[],
): { panel: number; type: number | null } | null {
  const panel = panels.findIndex((entry) => entry.id === target.panelId);
  if (panel === -1) return null;
  const type = target.typeId ? (panels[panel]?.types.findIndex((entry) => entry.id === target.typeId) ?? -1) : -1;
  return { panel, type: type === -1 ? null : type };
}

const PERMISSION_STEPS = "In Discord, open Server Settings, then Roles, choose the bot's role and turn on";

function settingsHref(guildId: string, section: string): string {
  return `/guilds/${guildId}/tickets/settings#section-${section}`;
}

interface Names {
  panel(id: string | undefined): string;
  type(id: string | undefined): string;
}

function namesFrom(panels: readonly TicketPanelOption[]): Names {
  return {
    panel: (id) => {
      const name = panels.find((panel) => panel.id === id)?.name.trim();
      return name ? `The ${name} panel` : "A panel";
    },
    type: (id) => {
      const name = panels.flatMap((panel) => panel.types).find((type) => type.id === id)?.name.trim();
      return name ? `The ${name} type` : "A ticket type";
    },
  };
}

function words(issue: TicketHealthIssue, names: Names, guildId: string): Omit<HealthLine, "code" | "tone" | "target"> {
  const panels = { label: "Go to Panels", href: settingsHref(guildId, "panels") };
  switch (issue.code) {
    case "missingManageChannels":
      return {
        title: "The bot cannot create ticket channels",
        detail: `${PERMISSION_STEPS} Manage Channels. Until then, members who press the panel get an error.`,
        fix: null,
      };
    case "missingManageThreads":
      return {
        title: "The bot cannot create ticket threads",
        detail: `${PERMISSION_STEPS} Manage Threads and Create Private Threads. Types that open as threads fail until then.`,
        fix: null,
      };
    case "missingManageWebhooks":
      return {
        title: "Replies from the dashboard are posted by the bot",
        detail: `They still arrive, with your name on the first line. ${PERMISSION_STEPS} Manage Webhooks to have them show your own name and picture.`,
        fix: null,
      };
    case "noPanels":
      return {
        title: "There is no panel yet",
        detail: "Members open tickets from a panel, a message with a button for each kind of help. Add one to get started.",
        fix: { label: "Add a panel", href: settingsHref(guildId, "panels") },
      };
    case "noPanelsPosted":
      return {
        title: "No panel has been posted in Discord",
        detail: "Members cannot open tickets until a panel is up. Post one from Panels.",
        fix: { label: "Post a panel", href: settingsHref(guildId, "panels") },
      };
    case "panelChannelMissing":
      return issue.channelId
        ? {
            title: `${names.panel(issue.panelId)} has lost its channel`,
            detail: "The channel it was set to post in was deleted. Pick another channel, save, then post it again.",
            fix: panels,
          }
        : {
            title: `${names.panel(issue.panelId)} has no channel`,
            detail: "Pick the channel it should be posted in, save, then post it.",
            fix: panels,
          };
    case "panelNotPosted":
      return {
        title: `${names.panel(issue.panelId)} is not posted`,
        detail: "It is set up but nobody can see it yet. Post it from Panels.",
        fix: { label: "Post it", href: settingsHref(guildId, "panels") },
      };
    case "panelLegacy":
      return {
        title: `${names.panel(issue.panelId)} was posted by an older version`,
        detail:
          "It still opens tickets, but it cannot be updated from here, because the older version did not note where it was posted. Post it again from Panels, then delete the old message in Discord.",
        fix: { label: "Post it again", href: settingsHref(guildId, "panels") },
      };
    case "categoryNotSet":
      return {
        title: `${names.type(issue.typeId)} has no category`,
        detail: "Its tickets are private channels, which Discord keeps in a category. Pick one, or open its tickets as private threads instead.",
        fix: panels,
      };
    case "categoryMissing":
      return {
        title: `The category for ${names.type(issue.typeId).replace(/^The /, "the ")} was deleted`,
        detail: "New tickets of that type cannot open until it has a category again.",
        fix: panels,
      };
    case "categoryFull":
      return issue.blocking
        ? {
            title: `The category for ${names.type(issue.typeId).replace(/^The /, "the ")} is full`,
            detail: `Discord allows ${CATEGORY_CHANNEL_LIMIT} channels in a category. Close old tickets, or add an overflow category for new ones to use.`,
            fix: panels,
          }
        : {
            title: `The first category for ${names.type(issue.typeId).replace(/^The /, "the ")} is full`,
            detail: "New tickets go to its overflow category for now. Closing old tickets makes room again.",
            fix: null,
          };
    case "typeNoHandlers":
      return {
        title: `${names.type(issue.typeId)} has no handlers`,
        detail: "Nobody is pinged when one of its tickets opens, and only managers and admin roles can work it. Add the roles that should answer.",
        fix: panels,
      };
    case "panelMessageMissing":
      return {
        title: `${names.panel(issue.panelId)} was deleted in Discord`,
        detail: "Its message is gone, so members cannot open tickets from it. Post it again from Panels.",
        fix: { label: "Post it again", href: settingsHref(guildId, "panels") },
      };
    case "panelChanged":
      return {
        title: `${names.panel(issue.panelId)} is out of date in Discord`,
        detail: "Its settings changed since it was posted. Update it from Panels so members see the change.",
        fix: { label: "Update it", href: settingsHref(guildId, "panels") },
      };
    case "panelMoved":
      return {
        title: `${names.panel(issue.panelId)} is still up in its old channel`,
        detail: "It still opens tickets there. Post it from Panels to move it to the channel it is set to now; the old message is taken down.",
        fix: { label: "Move it", href: settingsHref(guildId, "panels") },
      };
    case "typeEmojiMissing":
      return {
        title: `${names.type(issue.typeId)} uses an emoji from another server`,
        detail: "Discord will not post a panel with it. Pick one of this server's emoji or a standard one.",
        fix: panels,
      };
  }
}

export function healthLines(
  guildId: string,
  issues: readonly TicketHealthIssue[],
  panels: readonly TicketPanelOption[],
): HealthLine[] {
  const names = namesFrom(panels);
  const lines = issues.map((issue): HealthLine => {
    const worded = words(issue, names, guildId);
    const target = worded.fix && issue.panelId ? { panelId: issue.panelId, typeId: issue.typeId ?? null } : null;
    const label = worded.fix?.label === "Go to Panels" ? (target?.typeId ? "Open the type" : target ? "Open the panel" : "Go to Panels") : worded.fix?.label;
    const fix = worded.fix && label ? { label, href: settingsTargetHref(guildId, target) } : null;
    return { code: issue.code, tone: issue.blocking ? "danger" : "attention", title: worded.title, detail: worded.detail, fix, target };
  });
  // What stops tickets opening at all comes first; the order within each kind is the bot's.
  return [...lines.filter((line) => line.tone === "danger"), ...lines.filter((line) => line.tone === "attention")];
}

/**
 * The issues a page lists once the first-run steps are on screen, which are
 * also the ones the Settings tab's mark counts, so the two never disagree.
 */
export function shownIssues(context: { panels: readonly TicketPanelOption[]; health: readonly TicketHealthIssue[] }): TicketHealthIssue[] {
  return needsFirstRun(context) ? issuesBeyondFirstRun(context.health) : [...context.health];
}

/**
 * What the Settings tab's mark says, counted as the card on that tab counts.
 * Before the first panel is up it says tickets are not set up, which the
 * steps on the tab then explain. Null when nothing stops a ticket.
 */
export function healthTabText(context: { panels: readonly TicketPanelOption[]; health: readonly TicketHealthIssue[] }): string | null {
  const blocking = shownIssues(context).filter((issue) => issue.blocking).length;
  if (needsFirstRun(context)) {
    return blocking > 0
      ? `Tickets are not set up yet, and ${blocking === 1 ? "1 more problem stops" : `${blocking} more problems stop`} them opening`
      : "Tickets are not set up yet";
  }
  if (blocking === 0) return null;
  return blocking === 1 ? "1 problem stops tickets opening" : `${blocking} problems stop tickets opening`;
}

export interface HealthHeadline {
  title: string;
  detail: string;
}

/**
 * The health card's heading, worded by how much is broken: every type, some
 * types (named when it is one), or nothing that stops a ticket. It counts the
 * issues the card lists, so the heading and the list agree.
 */
export function healthHeadline(
  shown: readonly TicketHealthIssue[],
  panels: readonly TicketPanelOption[],
  summary: TicketHealthSummary | null | undefined,
): HealthHeadline {
  const blocking = shown.filter((issue) => issue.blocking).length;
  const warnings = shown.length - blocking;
  const fix = blocking === 1 ? "Fix it first." : "Fix them first.";
  if (blocking === 0) {
    return {
      title: "Worth a look",
      detail: warnings === 1 ? "Tickets open, but this makes them work less well." : "Tickets open, but these make them work less well.",
    };
  }
  const stops = blocking === 1 ? "One thing stops" : `${blocking} things stop`;
  if (summary?.state === "someBlocked") {
    const types = panels.flatMap((panel) => panel.types);
    const blocked = summary.blockedTypes.map((entry) => types.find((type) => type.id === entry.typeId)?.name.trim() || "A ticket type");
    if (blocked.length === 1) {
      return { title: `New ${blocked[0]} tickets cannot open`, detail: `The other types work. ${stops} this one. ${fix}` };
    }
    return {
      title: `${blocked.length} of ${summary.totalTypes} ticket types cannot open`,
      detail: `${blocked.join(", ")} cannot take new tickets. The others work. ${fix}`,
    };
  }
  return { title: "Members cannot open tickets yet", detail: `${stops} tickets from opening. ${fix}` };
}

/** A short line for the tab header: how many things stop tickets opening. */
export function healthSummary(issues: readonly TicketHealthIssue[]): string | null {
  const blocking = issues.filter((issue) => issue.blocking).length;
  const other = issues.length - blocking;
  if (blocking > 0) return blocking === 1 ? "1 problem stops tickets opening" : `${blocking} problems stop tickets opening`;
  if (other > 0) return other === 1 ? "1 thing to look at" : `${other} things to look at`;
  return null;
}

/** Why a ticket cannot be moved to a type right now, from the type's `problem` code, in a few words for the Move dialog. */
export function typeProblemText(code: TicketHealthCode): string {
  switch (code) {
    case "categoryNotSet":
      return "It has no category, so its channels cannot be made.";
    case "categoryMissing":
      return "Its category was deleted.";
    case "categoryFull":
      return "Its category is full.";
    case "missingManageChannels":
      return "The bot cannot create channels.";
    case "missingManageThreads":
      return "The bot cannot create threads.";
    case "panelChannelMissing":
      return "Its panel's channel was deleted.";
    default:
      return "It cannot take tickets right now.";
  }
}

export interface FirstRunStep {
  id: "panel" | "type" | "post";
  title: string;
  detail: string;
  done: boolean;
  /** The button's words. */
  action: string;
  /** The panel or type the button opens on the settings page, or null for the panel list itself. */
  target: SettingsTarget | null;
}

/**
 * The three things a server needs before members can open a ticket, and
 * which of them are done. Shown until a panel is posted. Each step's button
 * opens the part of the settings it is about: the panel whose channel is
 * missing, the type nobody answers, or the panel strip to post from.
 */
export function firstRunSteps(context: {
  panels: readonly TicketPanelOption[];
  health: readonly TicketHealthIssue[];
}): FirstRunStep[] {
  const codes = new Set(context.health.map((issue) => issue.code));
  const placed = (panel: TicketPanelOption) => panel.channelId !== null && panel.channelId !== "";
  const hasPanel = context.panels.some(placed);
  const unplaced = context.panels.find((panel) => !placed(panel));
  const unhandled = new Set(context.health.filter((issue) => issue.code === "typeNoHandlers").map((issue) => issue.typeId));
  const types = context.panels.flatMap((panel) => panel.types);
  const hasType = types.some((type) => !unhandled.has(type.id));
  const needsRoles = types.find((type) => unhandled.has(type.id));
  const posted = context.panels.length > 0 && !codes.has("noPanels") && !codes.has("noPanelsPosted");
  const first = context.panels[0];
  return [
    context.panels.length === 0
      ? {
          id: "panel",
          title: "Create a panel",
          detail: "A panel is the message members open tickets from. Name it and pick the channel it goes in.",
          done: false,
          action: "Add a panel",
          target: null,
        }
      : {
          id: "panel",
          title: "Pick the panel's channel",
          detail: "The channel members will see the panel in, with a button for each kind of help.",
          done: hasPanel,
          action: "Pick a channel",
          target: unplaced ? { panelId: unplaced.id, typeId: null } : first ? { panelId: first.id, typeId: null } : null,
        },
    {
      id: "type",
      title: "Choose who answers",
      detail: "Each ticket type is one button, such as Support or Reports. Pick the roles that answer it.",
      done: hasType,
      action: types.length === 0 ? "Add a ticket type" : "Pick the roles",
      target: needsRoles
        ? { panelId: needsRoles.panelId, typeId: needsRoles.id }
        : first
          ? { panelId: first.id, typeId: first.types[0]?.id ?? null }
          : null,
    },
    {
      id: "post",
      title: "Post it in Discord",
      detail: "Members press its button to open a private ticket with your team.",
      done: posted,
      action: "Post the panel",
      target: null,
    },
  ];
}

/** The settings page for one first-run step: the row it is about, or for posting, the panel strip at the top of Panels. */
export function firstRunHref(guildId: string, step: FirstRunStep): string {
  if (step.id === "post") return `/guilds/${guildId}/tickets/settings?post=1#section-panels`;
  return settingsTargetHref(guildId, step.target);
}

export function needsFirstRun(context: { panels: readonly TicketPanelOption[]; health: readonly TicketHealthIssue[] }): boolean {
  return firstRunSteps(context).some((step) => !step.done);
}

const FIRST_RUN_CODES = new Set(["noPanels", "noPanelsPosted", "panelChannelMissing", "panelNotPosted", "typeNoHandlers"]);

/**
 * What is left to say once the first-run steps are on screen, so the same
 * problem is not listed twice. The bot marks these; an older one does not,
 * and the codes stand in.
 */
export function issuesBeyondFirstRun(issues: readonly TicketHealthIssue[]): TicketHealthIssue[] {
  return issues.filter((issue) => (issue.firstRun === undefined ? !FIRST_RUN_CODES.has(issue.code) : !issue.firstRun));
}

export interface PostCheck {
  /** Discord would refuse the post, so it is not sent. */
  refuse: string | null;
  /** The post goes through, but some of its buttons cannot open a ticket yet. */
  warn: string | null;
}

/**
 * What to say before a panel is posted. A custom emoji from another server
 * makes Discord refuse the whole message, so that stops the post; a type
 * that cannot open tickets only earns a warning, since the rest of the panel
 * works. Both come from what the bot found in the saved settings, which are
 * what gets posted.
 */
export function panelPostCheck(panelId: string, panels: readonly TicketPanelOption[], issues: readonly TicketHealthIssue[]): PostCheck {
  const panel = panels.find((entry) => entry.id === panelId);
  if (!panel) return { refuse: null, warn: null };
  const name = (typeId: string | undefined) => panel.types.find((type) => type.id === typeId)?.name.trim() || "A ticket type";
  const emoji = issues.filter((issue) => issue.code === "typeEmojiMissing" && issue.panelId === panelId);
  if (emoji.length > 0) {
    const names = emoji.map((issue) => name(issue.typeId));
    return {
      refuse: `Discord will refuse this panel: ${names.join(", ")} ${names.length === 1 ? "uses an emoji" : "use emoji"} from another server. Pick one of this server's emoji or a standard one, save, then post.`,
      warn: null,
    };
  }
  const stopped = panel.types.filter((type) => type.problem);
  if (stopped.length === 0) return { refuse: null, warn: null };
  const lines = stopped.map((type) => `${type.name.trim() || "A ticket type"}: ${typeProblemText(type.problem!)}`);
  return {
    refuse: null,
    warn: `${stopped.length === 1 ? "This button cannot" : "These buttons cannot"} open a ticket yet. ${lines.join(" ")} Members who press ${stopped.length === 1 ? "it" : "them"} get an error until it is fixed.`,
  };
}
