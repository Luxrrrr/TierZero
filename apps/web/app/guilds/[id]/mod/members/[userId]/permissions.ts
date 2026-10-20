import { can, canDeleteNote, canEditInfraction, canEditNote, canVoidAction } from "@tier0/shared-moderation";
import type { InfractionDto, NoteDto, StaffRole } from "@tier0/shared-moderation";

/**
 * Which buttons a row offers. The bot enforces the same rules again, so this
 * only decides what is worth showing; it never grants anything.
 */

export interface InfractionControls {
  /** Change the reason. */
  edit: boolean;
  remove: boolean;
  restore: boolean;
  purge: boolean;
}

export function infractionControls(role: StaffRole, infraction: InfractionDto, viewerId = ""): InfractionControls {
  const removed = infraction.voided !== null;
  return {
    edit: !removed && canEditInfraction(role, infraction.moderator.userId === viewerId),
    remove: !removed && canVoidAction(role, infraction.action),
    restore: removed && can(role, "infraction.restore"),
    purge: can(role, "purge"),
  };
}

export interface NoteControls {
  edit: boolean;
  remove: boolean;
  restore: boolean;
  purge: boolean;
}

export function noteControls(role: StaffRole, note: NoteDto, viewerId: string): NoteControls {
  const deleted = note.deleted !== null;
  const isAuthor = note.author.userId === viewerId;
  return {
    edit: !deleted && canEditNote(role, isAuthor),
    remove: !deleted && canDeleteNote(role, isAuthor),
    restore: deleted && can(role, "note.restore"),
    purge: can(role, "purge"),
  };
}

/** Only roles that can read the audit trail see staff activity and per-entry history. */
export function seesAudit(role: StaffRole): boolean {
  return can(role, "audit.view");
}

/**
 * Quick facts summarise who on staff has touched the record, which is audit
 * information, so they follow the same rule.
 */
export function seesQuickFacts(role: StaffRole): boolean {
  return seesAudit(role);
}

export function canAddNote(role: StaffRole): boolean {
  return can(role, "note.add");
}

/**
 * Whether a removal by this role can be undone from the dashboard. Only
 * admins and the owner restore, so a moderator is told that someone else has
 * to do it.
 */
export function canRestoreOwnRemoval(role: StaffRole): boolean {
  return can(role, "infraction.restore");
}
