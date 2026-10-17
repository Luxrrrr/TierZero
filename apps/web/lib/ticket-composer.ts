import { fillSavedReply, savedReplyValues, type TicketDetailDto, type TicketSavedReplyDto } from "@tier0/core";

/**
 * What the reply box decides on its own: which saved replies match a search,
 * where an inserted one goes, and which attached files it can take. Free of
 * React and the DOM so the tests can import it.
 */

// The same wording as the workspace's own file sizes; repeated so the tests can load this file on its own.
function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export interface ReplyFileLimits {
  maxFiles: number;
  maxBytes: number;
}

/** The part of a file the checks need. A browser `File` has all of it. */
export interface FileLike {
  name: string;
  size: number;
}

export interface FileCheck<T extends FileLike> {
  /** The files that fit, in the order they were given. */
  accepted: T[];
  /** One sentence for each file left out, saying why. */
  problems: string[];
}

/**
 * Which of some new files fit beside the ones already attached. A file is
 * left out, with a reason, when it is empty, when it would take the reply over
 * the count, or when the bytes would add up to more than one reply carries.
 */
export function checkFiles<T extends FileLike>(current: readonly FileLike[], incoming: readonly T[], limits: ReplyFileLimits): FileCheck<T> {
  const accepted: T[] = [];
  const problems: string[] = [];
  let count = current.length;
  let bytes = current.reduce((sum, file) => sum + file.size, 0);
  for (const file of incoming) {
    if (file.size <= 0) {
      problems.push(`${file.name} is empty, and Discord does not take empty files.`);
      continue;
    }
    if (count >= limits.maxFiles) {
      problems.push(`${file.name} was not added: a reply can carry ${limits.maxFiles} files at most.`);
      continue;
    }
    if (bytes + file.size > limits.maxBytes) {
      problems.push(
        file.size > limits.maxBytes
          ? `${file.name} is ${formatBytes(file.size)}, more than the ${formatBytes(limits.maxBytes)} one reply can carry.`
          : `${file.name} was not added: the files would come to more than ${formatBytes(limits.maxBytes)}. Send it in another reply.`,
      );
      continue;
    }
    accepted.push(file);
    count += 1;
    bytes += file.size;
  }
  return { accepted, problems };
}

/** "3 files, 2.4 MB of 8 MB", for the line under the attached files. */
export function filesSummary(files: readonly FileLike[], limits: ReplyFileLimits): string {
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  const count = files.length === 1 ? "1 file" : `${files.length} files`;
  return `${count}, ${formatBytes(bytes) || "0 B"} of ${formatBytes(limits.maxBytes)}`;
}

/** The base64 of a `data:` address as FileReader gives it, which is what the bot takes. */
export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? "" : dataUrl.slice(comma + 1);
}

/** Whether a file can be shown as a small picture before it is sent. */
export function previewable(file: { type: string }): boolean {
  return /^image\/(png|jpe?g|gif|webp)$/i.test(file.type);
}

/**
 * The saved replies that match what was typed in their search: by name first,
 * then by their text, each keeping the order the server lists them in.
 */
export function matchSavedReplies(replies: readonly TicketSavedReplyDto[], query: string): TicketSavedReplyDto[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...replies];
  const byName = replies.filter((reply) => reply.name.toLowerCase().includes(needle));
  const byText = replies.filter((reply) => !byName.includes(reply) && reply.content.toLowerCase().includes(needle));
  return [...byName, ...byText];
}

/** A saved reply as it will read in this ticket, with the opener, the staff member and the ticket filled in. */
export function savedReplyText(reply: TicketSavedReplyDto, ticket: Pick<TicketDetailDto, "id" | "number" | "typeName" | "channelId" | "opener">, staffId: string): string {
  const values = savedReplyValues(
    { id: ticket.id, number: ticket.number ?? null, typeName: ticket.typeName, openerId: ticket.opener.userId, channelId: ticket.channelId },
    staffId,
  );
  return fillSavedReply(reply.content, values);
}

/**
 * Puts text in at the cursor, replacing any selection, with a space or a line
 * break between it and what is already there so the two do not run together.
 * Returns the new text and where the cursor goes.
 */
export function insertText(current: string, start: number, end: number, insert: string): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, current.length));
  const to = Math.max(from, Math.min(end, current.length));
  const before = current.slice(0, from);
  const after = current.slice(to);
  const lead = before === "" || /\s$/.test(before) ? "" : insert.includes("\n") ? "\n" : " ";
  const trail = after === "" || /^\s/.test(after) ? "" : " ";
  const text = `${before}${lead}${insert}${trail}${after}`;
  return { text, caret: before.length + lead.length + insert.length };
}

/** Under the reply box: who a reply can ping, since the conversation shows every mention the same way. */
export const MENTION_HINT =
  "Mentions of people in the ticket and of its handler and admin roles ping them. @everyone, @here and other roles never ping from here.";
