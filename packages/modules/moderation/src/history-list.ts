import { actionLabel, clip } from "./modlog.js";

export interface HistoryRecord {
  caseNumber: number;
  action: string;
  active: boolean;
  reason: string | null;
  createdAt: Date;
}

/** A reason this long still leaves a line that says what it is about; the full text is on the case. */
export const HISTORY_REASON_MAX = 120;

/**
 * Room for the list inside an embed description, which Discord caps at 4096
 * characters, leaving space for a message built around it.
 */
export const HISTORY_LIST_MAX = 3800;

function line(record: HistoryRecord): string {
  const seconds = Math.floor(record.createdAt.getTime() / 1000);
  const status = record.active ? "" : " (reversed)";
  const reason = clip((record.reason ?? "No reason given").replace(/\s+/g, " ").trim(), HISTORY_REASON_MAX);
  return `**#${record.caseNumber}** ${actionLabel(record.action)}${status} - ${reason} - <t:${seconds}:d>`;
}

const more = (count: number): string => `...and ${count} more.`;

/**
 * One line per case, newest first as given. Each reason is shortened and the
 * whole list stops short of `max`, saying how many cases were left off, so a
 * member with a long record cannot make the reply too big to send.
 */
export function historyList(records: HistoryRecord[], max = HISTORY_LIST_MAX): string {
  const lines = records.map(line);
  const whole = lines.join("\n");
  if (whole.length <= max) return whole;

  // Leave room for the closing line, which can name up to three digits of cases.
  const room = max - more(999).length - 1;
  const kept: string[] = [];
  let used = 0;
  for (const text of lines) {
    const next = used + text.length + (kept.length > 0 ? 1 : 0);
    if (next > room) break;
    kept.push(text);
    used = next;
  }
  return [...kept, more(lines.length - kept.length)].join("\n");
}
