import {
  TICKET_CREATE_MEMBERS_MAX,
  TICKET_CREATE_MESSAGE_MAX,
  TICKET_CREATE_SUBJECT_MAX,
  type TicketAnswer,
  type TicketPanelOption,
  type TicketTypeOption,
  type UserRef,
} from "@tier0/core";

/**
 * The pure side of the New ticket dialog: which types the viewer may open,
 * what a draft needs before it can be sent, and the request it makes.
 */

export interface CreatableGroup {
  id: string;
  name: string;
  types: TicketTypeOption[];
}

/** The panels' types the viewer handles, which are the ones they may open. Panels with none are left out. */
export function creatableTypes(panels: readonly TicketPanelOption[]): CreatableGroup[] {
  return panels
    .map((panel) => ({ id: panel.id, name: panel.name, types: panel.types.filter((type) => type.handled) }))
    .filter((panel) => panel.types.length > 0);
}

/** Types a ticket can be opened in right now, without one of the setup problems that stop it. */
export function openableTypes(groups: readonly CreatableGroup[]): TicketTypeOption[] {
  return groups.flatMap((group) => group.types).filter((type) => !type.problem);
}

export interface CreateDraft {
  typeId: string | null;
  subject: string;
  /** One entry per question of the chosen type, in order. */
  answers: string[];
  members: UserRef[];
  firstMessage: string;
}

export const emptyDraft = (typeId: string | null = null): CreateDraft => ({ typeId, subject: "", answers: [], members: [], firstMessage: "" });

/** Adds a member to the draft's list, once, up to the most a ticket can start with. */
export function withMember(members: readonly UserRef[], user: UserRef): { members: UserRef[]; problem: string | null } {
  if (!user.inServer) return { members: [...members], problem: `${user.name ?? "That person"} is not in the server, so they cannot be added.` };
  if (members.some((member) => member.userId === user.userId)) return { members: [...members], problem: null };
  if (members.length >= TICKET_CREATE_MEMBERS_MAX) {
    return { members: [...members], problem: `A ticket can start with at most ${TICKET_CREATE_MEMBERS_MAX} members besides you.` };
  }
  return { members: [...members, user], problem: null };
}

/** What stops a draft being sent, in words for the form, or null when it can go. */
export function draftProblem(draft: CreateDraft, type: TicketTypeOption | undefined): string | null {
  if (!draft.typeId || !type) return "Pick the type of ticket to open.";
  if (draft.members.length === 0) return "Add at least one member to the ticket.";
  if (draft.members.length > TICKET_CREATE_MEMBERS_MAX) return `Add at most ${TICKET_CREATE_MEMBERS_MAX} members.`;
  if (draft.subject.trim().length > TICKET_CREATE_SUBJECT_MAX) return `The subject can be at most ${TICKET_CREATE_SUBJECT_MAX} characters.`;
  if (draft.firstMessage.trim().length > TICKET_CREATE_MESSAGE_MAX) {
    return `The first message can be at most ${TICKET_CREATE_MESSAGE_MAX} characters.`;
  }
  return null;
}

export interface CreateBody {
  typeId: string;
  subject: string | null;
  answers: TicketAnswer[];
  memberIds: string[];
  firstMessage: string | null;
}

/** The request for a draft: answers the staff member filled in, paired with their question. */
export function createRequest(draft: CreateDraft, type: TicketTypeOption): CreateBody {
  const questions = type.questions ?? [];
  const answers = questions
    .map((question, index) => ({ label: question.label, value: (draft.answers[index] ?? "").trim() }))
    .filter((answer) => answer.value !== "");
  const subject = draft.subject.trim();
  const firstMessage = draft.firstMessage.trim();
  return {
    typeId: type.id,
    subject: subject === "" ? null : subject,
    answers,
    memberIds: draft.members.map((member) => member.userId),
    firstMessage: firstMessage === "" ? null : firstMessage,
  };
}

/**
 * Why opening a ticket failed, worded for this dialog. The bot's own sentence
 * wins; the status only words what it did not say, such as an older bot that
 * has no such route.
 */
export function createFailureText(status: number, error: string): string {
  if (status === 404) return "This bot is too old to open tickets from the dashboard. Update it, then try again.";
  if (error.trim() === "" && status === 403) return "You can only open tickets of the types you handle.";
  return error;
}
