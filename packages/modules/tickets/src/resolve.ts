import { LEGACY_TYPE_ID, type TicketAccessSettings, type TicketAnswer } from "@tier0/core";
import type { FormQuestion, TicketPanel, TicketType } from "./panels.js";
import { atLeastAMinute } from "./records.js";
import type { TicketSettings } from "./settings.js";

/**
 * Answers the questions the runtime and the control API ask of parsed ticket
 * settings: which type a button or a ticket means, what a per-type setting
 * comes to once the general one is taken into account, and who may open a
 * ticket. Free of discord.js and of the database so it can be tested with
 * plain objects.
 */

export interface PanelType {
  panel: TicketPanel;
  type: TicketType;
}

export function findPanel(settings: TicketSettings, panelId: string): TicketPanel | undefined {
  return settings.panels.find((panel) => panel.id === panelId);
}

/** Every type on every panel, in panel order. */
export function allTypes(settings: TicketSettings): PanelType[] {
  return settings.panels.flatMap((panel) => panel.types.map((type) => ({ panel, type })));
}

/**
 * The type a panel button or menu option names. Type ids are unique across a
 * server, so a type that moved to another panel is still found; the panel id
 * only decides between two that somehow share an id.
 */
export function findType(settings: TicketSettings, panelId: string | null, typeId: string): PanelType | undefined {
  const matches = allTypes(settings).filter(({ type }) => type.id === typeId);
  return matches.find(({ panel }) => panel.id === panelId) ?? matches[0];
}

/** The type a stored ticket belongs to. A ticket from before types existed belongs to the one the upgrade created. */
export function typeOfTicket(settings: TicketSettings, ticket: { panelId: string | null; typeId: string | null }): PanelType | undefined {
  return findType(settings, ticket.panelId, ticket.typeId ?? LEGACY_TYPE_ID);
}

/**
 * What an old panel's single button opens: the type the upgrade created when
 * it still exists, otherwise the first type of the first panel.
 */
export function legacyButtonType(settings: TicketSettings): PanelType | undefined {
  return findType(settings, null, LEGACY_TYPE_ID) ?? allTypes(settings)[0];
}

/** What the button or menu option says. */
export function typeLabel(type: TicketType): string {
  return type.appearance.buttonLabel?.trim() || type.name;
}

export function effectiveLimit(settings: TicketSettings, type: TicketType): number {
  return type.rules.limit ?? settings.general.ticketLimit;
}

export function effectiveChannelName(settings: TicketSettings, type: TicketType): string {
  const own = type.opening.channelName?.trim();
  return own ? own : settings.general.channelName;
}

export interface EffectiveAutoClose {
  enabled: boolean;
  /** Milliseconds of inactivity. */
  after: number;
  /** Post the closing message first. */
  notice: boolean;
}

/**
 * The inactivity close a type's tickets get. A ticket whose type was removed
 * follows Automation. The wait is never under a minute, whatever was saved.
 */
export function effectiveAutoClose(settings: TicketSettings, type: TicketType | undefined): EffectiveAutoClose {
  const general = settings.automation.autoClose;
  switch (type?.overrides.autoClose) {
    case "off":
      return { enabled: false, after: atLeastAMinute(general.after), notice: general.notice };
    case "custom":
      return { enabled: true, after: atLeastAMinute(type.overrides.autoCloseAfter), notice: general.notice };
    default:
      return { enabled: general.enabled, after: atLeastAMinute(general.after), notice: general.notice };
  }
}

/** Where the transcript file and the closed summary go, or null when nowhere. */
export function effectiveTranscriptChannel(settings: TicketSettings, type: TicketType | undefined): string | null {
  return type?.overrides.transcriptChannel ?? settings.transcripts.logChannel ?? null;
}

export function ratingEnabled(settings: TicketSettings, type: TicketType | undefined): boolean {
  const own = type?.overrides.rating ?? "inherit";
  return own === "inherit" ? settings.ratings.enabled : own === "on";
}

export function handlersOf(type: TicketType): string[] {
  return [...type.handlers];
}

/** The roles a new ticket's first message may ping. */
export function pingRolesOf(type: TicketType): string[] {
  switch (type.opening.ping) {
    case "none":
      return [];
    case "roles":
      return [...type.opening.pingRoles];
    default:
      return [...type.handlers];
  }
}

/**
 * Roles that work a type's tickets in Discord: its handlers and the server's
 * admin roles. Observers can see and write in the channel but are not staff.
 */
export function staffRolesOf(settings: TicketSettings, type: TicketType | undefined): string[] {
  return [...new Set([...(type?.handlers ?? []), ...settings.general.adminRoles])];
}

/** Every role that is given access to a type's channel: staff and observers. */
export function channelRolesOf(settings: TicketSettings, type: TicketType): string[] {
  return [...new Set([...staffRolesOf(settings, type), ...type.opening.observers])];
}

/** What the core access rules need from these settings. */
export function accessSettingsOf(settings: TicketSettings): TicketAccessSettings {
  return {
    adminRoleIds: settings.general.adminRoles,
    types: allTypes(settings).map(({ type }) => ({ id: type.id, handlerRoleIds: type.handlers, claim: type.rules.claim })),
    claimLock: settings.general.claimLock,
    reopen: settings.general.closeBehaviour === "archive" && settings.general.reopen,
  };
}

export interface Opener {
  id: string;
  roleIds: readonly string[];
}

/** The server's blocklist, which applies to every type. */
export function isBlocked(settings: TicketSettings, member: Opener): boolean {
  const { members, roles } = settings.general.blocklist;
  return members.includes(member.id) || member.roleIds.some((id) => roles.includes(id));
}

export type OpenPermission = { allowed: true } | { allowed: false; code: "blocked" | "notAllowed" };

/**
 * Whether a member may open a type at all, before limits and cooldowns. The
 * blocklist is checked first so a blocked member is told that, not that they
 * lack a role.
 */
export function mayOpen(settings: TicketSettings, type: TicketType, member: Opener): OpenPermission {
  if (isBlocked(settings, member)) return { allowed: false, code: "blocked" };
  const { allowedRoles, blockedRoles } = type.rules;
  if (member.roleIds.some((id) => blockedRoles.includes(id))) return { allowed: false, code: "notAllowed" };
  if (allowedRoles.length > 0 && !member.roleIds.some((id) => allowedRoles.includes(id))) {
    return { allowed: false, code: "notAllowed" };
  }
  return { allowed: true };
}

/** Milliseconds a member waits between tickets of this type, 0 for none. */
export function cooldownOf(type: TicketType): number {
  return type.rules.cooldown ?? 0;
}

/** When a member who just opened a ticket of this type may open another, or null when there is no wait. */
export function cooldownUntil(type: TicketType, openedAt: Date): Date | null {
  const wait = cooldownOf(type);
  return wait > 0 ? new Date(openedAt.getTime() + wait) : null;
}

/** Discord's own bound on a text input. */
const INPUT_MAX = 4000;

/** A question's length bounds as Discord will accept them: within 0 to 4000, with the minimum no higher than the maximum. */
export function questionBounds(question: FormQuestion): { min: number | undefined; max: number } {
  const max = Math.min(question.maxLength ?? INPUT_MAX, INPUT_MAX);
  const min = question.minLength === undefined ? undefined : Math.min(question.minLength, max);
  return { min, max };
}

/** The answers in form order, labelled with the question as it read when the ticket opened. */
export function answersOf(form: readonly FormQuestion[], values: readonly (string | null | undefined)[]): TicketAnswer[] {
  return form.map((question, index) => ({ label: question.label, value: (values[index] ?? "").trim() }));
}

/** The subject stored on the ticket: the first answer given, held to the length the subject always had. */
export function subjectOf(answers: readonly TicketAnswer[]): string | null {
  const first = answers.find((answer) => answer.value !== "");
  return first ? first.value.slice(0, 200) : null;
}

/**
 * What follows `tickets:open:` on a panel button and `tickets:subject:` on the
 * form it opens: the panel and the type. An old panel's button has nothing
 * there, which reads as null and means the type its single button became.
 */
export function openTargetOf(rest: string): { panelId: string; typeId: string } | null {
  const [panelId, typeId, ...extra] = rest.split(":");
  if (!panelId || !typeId || extra.length > 0) return null;
  return { panelId, typeId };
}

export function openTargetRest(panelId: string, typeId: string): string {
  return `${panelId}:${typeId}`;
}
