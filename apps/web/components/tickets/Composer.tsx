"use client";

import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { TICKET_REPLY_MAX, type TicketDetailDto, type TicketMessageDto, type TicketReplyFile, type TicketSavedReplyDto } from "@tier0/core";
import { CharacterCount } from "../../app/guilds/[id]/mod/members/[userId]/CharacterCount";
import { useToast } from "../Toaster";
import { InfoIcon, LockIcon, MessagesIcon, PaperclipIcon, SendIcon, XIcon } from "../Icons";
import { formatBytes } from "../../lib/ticket-format";
import {
  base64FromDataUrl,
  checkFiles,
  filesSummary,
  insertText,
  matchSavedReplies,
  MENTION_HINT,
  previewable,
  savedReplyText,
  type ReplyFileLimits,
} from "../../lib/ticket-composer";
import { replyWithFiles, ticketsClient } from "../../lib/tickets-client";
import { useUnsavedGuard } from "../../lib/unsaved-guard";

interface Props {
  guildId: string;
  ticket: Pick<TicketDetailDto, "id" | "number" | "typeName" | "channelId" | "opener">;
  viewerId: string;
  openerName: string;
  /** The bot posts replies under the staff member's name; otherwise it posts them itself, naming them. */
  webhooks: boolean;
  /** Why the viewer cannot reply here, or null when they can. */
  blocked: string | null;
  /** The server's saved replies, to insert. */
  savedReplies: readonly TicketSavedReplyDto[];
  /** What a reply may attach, or null for a bot that takes no files from the dashboard. */
  replyFiles: ReplyFileLimits | null;
  onSent(message: TicketMessageDto): void;
}

interface Attached {
  key: string;
  file: File;
  /** A picture to show before it is sent, released when the file goes. */
  url: string | null;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

let fileSeed = 0;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
    reader.onload = () => resolve(base64FromDataUrl(String(reader.result ?? "")));
    reader.readAsDataURL(file);
  });
}

/**
 * Where staff answer a ticket. What is typed is sent to the ticket's channel
 * in Discord as it is, so Discord's own formatting works. Files can be added
 * with the button, dropped on the box or pasted, and saved replies inserted
 * with their names filled in. A failed send keeps the text and the files, and
 * leaving with a draft asks first, so nothing written is lost.
 */
export function Composer({ guildId, ticket, viewerId, openerName, webhooks, blocked, savedReplies, replyFiles, onSent }: Props) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [fileProblems, setFileProblems] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mod, setMod] = useState("Ctrl");
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  // State updates land a render late; a quick second Ctrl+Enter must not send the reply twice.
  const sendingRef = useRef(false);
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const filesId = `${id}-files`;

  const clearFiles = () => {
    for (const entry of filesRef.current) if (entry.url) URL.revokeObjectURL(entry.url);
    setFiles([]);
    setFileProblems([]);
  };

  const guard = useUnsavedGuard({
    dirty: !blocked && (text.trim() !== "" || files.length > 0),
    onDiscard: () => {
      setText("");
      clearFiles();
    },
  });

  useEffect(() => setMod(isMac() ? "⌘" : "Ctrl"), []);

  useEffect(
    () => () => {
      for (const entry of filesRef.current) if (entry.url) URL.revokeObjectURL(entry.url);
    },
    [],
  );

  // Grows with what is typed, up to a point, so a long answer stays readable.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    if (caret.current !== null) {
      el.focus();
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [text]);

  if (blocked) {
    return (
      <div className="tk-composer tk-composer--off">
        <LockIcon />
        <p>{blocked}</p>
      </div>
    );
  }

  const trimmed = text.trim();
  const tooLong = trimmed.length > TICKET_REPLY_MAX;

  function addFiles(list: FileList | File[] | null) {
    if (!replyFiles || !list) return;
    const incoming = [...list];
    if (incoming.length === 0) return;
    const { accepted, problems } = checkFiles(filesRef.current.map((entry) => entry.file), incoming, replyFiles);
    setFileProblems(problems);
    if (accepted.length === 0) return;
    setError(null);
    setFiles((current) => [
      ...current,
      ...accepted.map((file) => {
        fileSeed += 1;
        return { key: `file-${fileSeed}`, file, url: previewable(file) ? URL.createObjectURL(file) : null };
      }),
    ]);
  }

  function removeFile(key: string) {
    setFiles((current) => {
      const gone = current.find((entry) => entry.key === key);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return current.filter((entry) => entry.key !== key);
    });
    setFileProblems([]);
    field.current?.focus();
  }

  function insertSaved(reply: TicketSavedReplyDto) {
    const el = field.current;
    const filled = savedReplyText(reply, ticket, viewerId);
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = insertText(text, start, end, filled);
    caret.current = next.caret;
    setText(next.text);
    setError(null);
  }

  async function send() {
    if (sendingRef.current) return;
    if (trimmed === "" && files.length === 0) {
      setError("Write a reply or attach a file before sending.");
      field.current?.focus();
      return;
    }
    if (tooLong) {
      setError(`A reply can be at most ${TICKET_REPLY_MAX} characters. This one is ${trimmed.length}.`);
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      let result;
      if (files.length > 0) {
        setProgress(0);
        let encoded: TicketReplyFile[];
        try {
          encoded = await Promise.all(
            files.map(async (entry) => ({ name: entry.file.name, contentType: entry.file.type || null, data: await readBase64(entry.file) })),
          );
        } catch {
          setError("One of the files could not be read from this device. Remove it and attach it again.");
          return;
        }
        result = await replyWithFiles(guildId, ticket.id, { content: trimmed, files: encoded }, setProgress);
      } else {
        result = await ticketsClient.reply(guildId, ticket.id, { content: trimmed });
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setText("");
      clearFiles();
      onSent(result.value.message);
      if (result.value.delivery === "bot" && webhooks) {
        toast.push({
          kind: "success",
          title: "Reply sent",
          detail: "The bot could not use a webhook in this channel, so it posted the reply itself with your name on the first line.",
        });
      }
      field.current?.focus();
    } finally {
      sendingRef.current = false;
      setSending(false);
      setProgress(null);
    }
  }

  const hasFiles = (event: DragEvent) => [...event.dataTransfer.types].includes("Files");

  return (
    <form
      className="tk-composer"
      data-busy={sending ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      onDragEnter={(event) => {
        if (!replyFiles || !hasFiles(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!replyFiles || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        if (!replyFiles || !hasFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      {guard.host}
      <label className="visually-hidden" htmlFor={id}>
        Reply to {openerName}
      </label>
      <textarea
        ref={field}
        id={id}
        className="tk-composer-input"
        rows={2}
        value={text}
        placeholder={`Reply to ${openerName}`}
        aria-describedby={[hintId, files.length > 0 ? filesId : null, error ? errorId : null].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        readOnly={sending}
        data-shortcut="reply"
        onChange={(event) => {
          setText(event.target.value);
          if (error) setError(null);
        }}
        onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
          if (!replyFiles || event.clipboardData.files.length === 0) return;
          // A copied picture comes with no text; a copied file from a folder may come with its name, which is not wanted either.
          event.preventDefault();
          addFiles(event.clipboardData.files);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void send();
          }
        }}
      />
      {dragging ? (
        <p className="tk-composer-drop" aria-hidden="true">
          Drop to attach
        </p>
      ) : null}

      {files.length > 0 ? (
        <div className="tk-composer-files" id={filesId}>
          <ul className="tk-files" aria-label="Attached files">
            {files.map((entry) => (
              <li key={entry.key} className="tk-file">
                {entry.url ? (
                  <img className="tk-file-thumb" src={entry.url} alt="" />
                ) : (
                  <span className="tk-file-icon" aria-hidden="true">
                    <PaperclipIcon />
                  </span>
                )}
                <span className="tk-file-text">
                  <span className="tk-file-name" title={entry.file.name}>
                    {entry.file.name}
                  </span>
                  <span className="tk-file-size">{formatBytes(entry.file.size)}</span>
                </span>
                <button
                  type="button"
                  className="icon-btn tk-file-remove"
                  aria-label={`Remove ${entry.file.name}`}
                  disabled={sending}
                  onClick={() => removeFile(entry.key)}
                >
                  <XIcon />
                </button>
              </li>
            ))}
          </ul>
          {replyFiles ? <p className="tk-files-sum">{filesSummary(files.map((entry) => entry.file), replyFiles)}</p> : null}
        </div>
      ) : null}

      {fileProblems.length > 0 ? (
        <ul className="tk-composer-error tk-file-problems" role="alert">
          {fileProblems.map((problem, index) => (
            <li key={index}>{problem}</li>
          ))}
        </ul>
      ) : null}

      {progress !== null ? (
        <div className="tk-upload" role="status">
          <span className="tk-upload-track" aria-hidden="true">
            <span className="tk-upload-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
          <span className="tk-upload-text">
            {progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Sending to Discord"}
          </span>
        </div>
      ) : null}

      {error ? (
        <p className="tk-composer-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}

      <div className="tk-composer-bar">
        <div className="tk-composer-tools">
          {replyFiles ? (
            <>
              <input
                ref={picker}
                type="file"
                multiple
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <button type="button" className="btn btn-ghost btn-sm" disabled={sending} onClick={() => picker.current?.click()}>
                <PaperclipIcon />
                Attach
              </button>
            </>
          ) : null}
          {savedReplies.length > 0 ? <SavedReplies replies={savedReplies} disabled={sending} onPick={insertSaved} onDone={() => field.current?.focus()} /> : null}
        </div>
        <div className="tk-composer-send">
          <CharacterCount length={trimmed.length} limit={TICKET_REPLY_MAX} />
          <span className="tk-composer-keys" aria-hidden="true">
            <span className="kbd">{mod}</span>
            <span className="kbd">Enter</span>
          </span>
          <button type="submit" className="btn btn-primary btn-sm" aria-disabled={sending || undefined}>
            {sending ? <span className="spinner" aria-hidden="true" /> : <SendIcon />}
            {sending ? "Sending" : "Send"}
          </button>
        </div>
      </div>
      <p className="tk-composer-hint" id={hintId}>
        <InfoIcon />
        <span>
          {webhooks ? "Sent to Discord under your name." : "Sent by the bot, with your name on the first line."} {MENTION_HINT}
          {replyFiles
            ? ` Drop or paste files to attach them, up to ${replyFiles.maxFiles} and ${formatBytes(replyFiles.maxBytes)} in all.`
            : " Files can only be attached in Discord."}
        </span>
      </p>
    </form>
  );
}

/**
 * The saved replies, searchable. Arrow keys move through the matches, Enter
 * puts the one picked into the reply box at the cursor with the ticket's
 * details filled in, and Escape goes back to the box.
 */
function SavedReplies({
  replies,
  disabled,
  onPick,
  onDone,
}: {
  replies: readonly TicketSavedReplyDto[];
  disabled: boolean;
  onPick(reply: TicketSavedReplyDto): void;
  onDone(): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const matches = matchSavedReplies(replies, query);
  const current = Math.min(active, Math.max(0, matches.length - 1));

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node | null)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
    onDone();
  };

  const pick = (reply: TicketSavedReplyDto | undefined) => {
    if (!reply) return;
    onPick(reply);
    setOpen(false);
    setQuery("");
    setActive(0);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(matches.length === 0 ? 0 : (current + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(matches.length === 0 ? 0 : (current - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(matches[current]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <div className="tk-saved" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <MessagesIcon />
        Saved replies
      </button>
      {open ? (
        <div className="tk-saved-panel">
          <input
            ref={searchRef}
            type="search"
            className="input tk-saved-search"
            role="combobox"
            aria-label="Search saved replies"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={matches[current] ? `${listId}-${current}` : undefined}
            placeholder="Search saved replies"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
          {matches.length === 0 ? (
            <p className="tk-saved-empty">No saved reply matches.</p>
          ) : (
            <ul className="tk-saved-list" role="listbox" id={listId} aria-label="Saved replies">
              {matches.map((reply, index) => (
                <li
                  key={`${reply.name}-${index}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === current}
                  className="tk-saved-option"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => pick(reply)}
                  onMouseEnter={() => setActive(index)}
                >
                  <span className="tk-saved-name">{reply.name}</span>
                  <span className="tk-saved-text">{reply.content}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="tk-saved-foot">Names and the ticket number are filled in as it is inserted. Saved replies are set under Settings.</p>
        </div>
      ) : null}
    </div>
  );
}
