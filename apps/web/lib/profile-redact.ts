import { can } from "@tier0/shared-moderation";
import type { MemberProfile, StaffRole } from "@tier0/shared-moderation";

/**
 * Trims a member profile to what the viewer's role may read before it leaves
 * the server. Hiding a section in the browser is not enough: everything handed
 * to a client component ends up in the page source.
 *
 * - Without `audit.view`, the audit trail is dropped entirely.
 * - Without `note.restore`, a deleted note keeps its place on the record and
 *   who deleted it, but not its text: only staff who could bring it back may
 *   read what it said.
 */
export function redactProfile(profile: MemberProfile, role: StaffRole): MemberProfile {
  const audit = can(role, "audit.view") ? profile.audit : [];
  const notes = can(role, "note.restore")
    ? profile.notes
    : profile.notes.map((note) => (note.deleted ? { ...note, content: "" } : note));
  if (audit === profile.audit && notes === profile.notes) return profile;
  return { ...profile, audit, notes };
}
