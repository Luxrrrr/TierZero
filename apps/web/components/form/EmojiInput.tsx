"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import useSWR from "swr";
import {
  customEmojiParts,
  customEmojiUrl,
  customEmojiValue,
  normalizeEmojiInput,
  searchEmoji,
  type ServerEmoji,
} from "../../lib/emoji";
import { SearchIcon, XIcon } from "../Icons";
import { useOutsideClose } from "./Combobox";
import { FetchError, fetchJson } from "./fetcher";

interface Props {
  id: string;
  guildId: string;
  /** Names the picker button and its list. */
  label: string;
  value: string | undefined;
  onChange(next: string | undefined): void;
  clearable?: boolean;
  disabled?: boolean;
  "aria-describedby"?: string;
}

interface EmojiList {
  emojis: ServerEmoji[];
  /** The list failed for a reason worth saying. A bot without the emoji route is not one. */
  failed: boolean;
  retry(): void;
}

/** One fetch per server, shared by every emoji field on the page. */
export function useServerEmojis(guildId: string): EmojiList {
  const { data, error, mutate } = useSWR<ServerEmoji[]>(`/api/guilds/${guildId}/emojis`, fetchJson, {
    shouldRetryOnError: false,
  });
  const missingRoute = error instanceof FetchError && error.status === 404;
  return {
    emojis: Array.isArray(data) ? data : [],
    failed: error !== undefined && !missingRoute && data === undefined,
    retry: () => void mutate(),
  };
}

/** What the box shows: a custom emoji by its name, which is how people know it. */
function shownText(value: string | undefined): string {
  if (!value) return "";
  const custom = customEmojiParts(value);
  return custom ? `:${custom.name}:` : value;
}

/**
 * An emoji setting: the server's own emoji and a set of standard ones to pick
 * from, or anything pasted. Typing `:name:` finds the server's emoji of that
 * name when the box is left, so nobody needs Discord's `<:name:id>` form.
 */
export function EmojiInput({
  id,
  guildId,
  label,
  value,
  onChange,
  clearable = false,
  disabled = false,
  "aria-describedby": describedBy,
}: Props) {
  const { emojis, failed, retry } = useServerEmojis(guildId);
  const [text, setText] = useState(shownText(value));
  const [typed, setTyped] = useState(false);
  const [seen, setSeen] = useState(value);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // A value changed elsewhere, a discarded draft or a pick, resets the box.
  if (value !== seen) {
    setSeen(value);
    if (!typed) setText(shownText(value));
  }

  useOutsideClose(rootRef, open, () => setOpen(false));

  function commit() {
    if (!typed) return;
    setTyped(false);
    const next = normalizeEmojiInput(text, emojis);
    setText(shownText(next || undefined));
    onChange(next === "" ? undefined : next);
  }

  function pick(next: string) {
    setTyped(false);
    setText(shownText(next));
    onChange(next === "" ? undefined : next);
    setOpen(false);
    buttonRef.current?.focus();
  }

  const custom = value ? customEmojiParts(value) : null;
  const known = custom ? emojis.find((emoji) => emoji.id === custom.id) : undefined;

  return (
    <div className="emoji-field" ref={rootRef}>
      <div className="emoji-field-row">
        <span className="emoji-preview" aria-hidden="true">
          {custom ? (
            <img src={known?.url ?? customEmojiUrl(custom)} alt="" width={20} height={20} />
          ) : value ? (
            value
          ) : null}
        </span>
        <input
          id={id}
          className="input emoji-input"
          type="text"
          value={text}
          placeholder=":name: or 🙂"
          disabled={disabled}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setTyped(true);
            setText(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
        <button
          type="button"
          ref={buttonRef}
          className="btn btn-secondary btn-sm"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          Choose
          <span className="visually-hidden"> an emoji for {label}</span>
        </button>
        {clearable && value ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            disabled={disabled}
            onClick={() => pick("")}
          >
            <XIcon />
            <span className="visually-hidden">Remove the emoji from {label}</span>
          </button>
        ) : null}
      </div>
      {failed ? (
        <p className="picker-failed" role="status">
          <span>This server&apos;s own emoji could not be loaded. Standard emoji still work.</span>
          <button type="button" className="link-button" onClick={retry}>
            Try again
          </button>
        </p>
      ) : null}
      {open ? (
        <EmojiPopup
          label={label}
          emojis={emojis}
          onPick={(next) => pick(next)}
          onClose={() => {
            setOpen(false);
            buttonRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

interface PopupProps {
  label: string;
  emojis: ServerEmoji[];
  onPick(value: string): void;
  onClose(): void;
}

function EmojiPopup({ label, emojis, onPick, onClose }: PopupProps) {
  const baseId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const found = useMemo(() => searchEmoji(query, emojis), [query, emojis]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    // Otherwise the same key press also closes whatever holds this popup.
    event.stopPropagation();
    onClose();
  }

  const nothing = found.server.length === 0 && found.unicode.length === 0;

  return (
    <div className="combobox-popover emoji-popover" role="dialog" aria-label={`Emoji for ${label}`} onKeyDown={onKeyDown}>
      <div className="combobox-search">
        <SearchIcon />
        <input
          ref={searchRef}
          type="text"
          aria-label="Search emoji"
          placeholder="Search emoji"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const first = found.server[0];
            if (first) onPick(customEmojiValue(first));
            else if (found.unicode[0]) onPick(found.unicode[0].char);
          }}
        />
      </div>
      <div className="emoji-popover-body">
        {nothing ? <p className="combobox-empty">No emoji matches that. You can still paste one into the box.</p> : null}
        {found.server.length > 0 ? (
          <section aria-labelledby={`${baseId}-server`}>
            <h3 className="combobox-group-label" id={`${baseId}-server`}>
              This server
            </h3>
            <div className="emoji-grid">
              {found.server.map((emoji) => (
                <button
                  key={emoji.id}
                  type="button"
                  className="emoji-option"
                  title={`:${emoji.name}:`}
                  onClick={() => onPick(customEmojiValue(emoji))}
                >
                  <img src={emoji.url} alt="" width={24} height={24} loading="lazy" />
                  <span className="visually-hidden">{emoji.name}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {found.unicode.length > 0 ? (
          <section aria-labelledby={`${baseId}-standard`}>
            <h3 className="combobox-group-label" id={`${baseId}-standard`}>
              Standard
            </h3>
            <div className="emoji-grid">
              {found.unicode.map((emoji) => (
                <button
                  key={emoji.name}
                  type="button"
                  className="emoji-option"
                  title={`:${emoji.name}:`}
                  onClick={() => onPick(emoji.char)}
                >
                  <span aria-hidden="true">{emoji.char}</span>
                  <span className="visually-hidden">{emoji.name.replace(/_/g, " ")}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
