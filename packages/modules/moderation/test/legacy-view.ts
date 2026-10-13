import { actionLabel, clip, type ModLogEntry } from "../dist/modlog.js";

/**
 * How a case looked before its wording could be changed, written out by hand.
 * The module no longer builds this itself: the default mod log post and /case
 * reply come from the editable message. The tests keep it as the reference they
 * are compared with, so a change to a default shows up as a failing test.
 */

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface ModLogView {
  title: string;
  fields: EmbedField[];
}

const FIELD_MAX = 1024;

export function formatModLogEntry(entry: ModLogEntry): ModLogView {
  const fields: EmbedField[] = [
    { name: "Member", value: `<@${entry.targetId}> (${entry.targetId})`, inline: true },
    {
      name: "Moderator",
      value: entry.moderatorName ?? `<@${entry.moderatorId}> (${entry.moderatorId})`,
      inline: true,
    },
    { name: "Reason", value: clip(entry.reason ?? "No reason given", FIELD_MAX) },
  ];
  if (entry.expiresAt) {
    const seconds = Math.floor(entry.expiresAt.getTime() / 1000);
    fields.push({ name: "Expires", value: `<t:${seconds}:f> (<t:${seconds}:R>)` });
  }
  return {
    title: `Case #${entry.caseNumber} - ${actionLabel(entry.action)}`,
    fields,
  };
}
