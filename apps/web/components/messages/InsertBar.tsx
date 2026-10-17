"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import useSWR from "swr";
import { MESSAGE_VARIABLES, TIMESTAMP_STYLES, discordTimestamp, type TimestampStyle } from "@tier0/core";
import { useChannels, useRoles } from "../form";
import { formatDiscordTime } from "./MessagePreview";

type Field = HTMLTextAreaElement | HTMLInputElement;

/**
 * What a text box can take, which follows what Discord draws there. Message text,
 * an embed's description and a field's value show the full set of formatting,
 * mentions and times. A title, a name or a footer shows only plain text and
 * emoji. An image address can only be filled from a variable.
 */
export type ToolReach = "full" | "inline" | "variables" | "none";

interface ActiveField {
  label: string;
  reach: ToolReach;
  /** What the Variables tool offers while this box is the one being edited. */
  variables?: readonly InsertVariable[];
  insert(text: string): void;
  wrap(before: string, after?: string): void;
}

interface ToolsState {
  active: ActiveField | null;
  setActive(field: ActiveField): void;
  /** Lets go of a box that is leaving, if it is the one the toolbar is pointed at. */
  release(field: ActiveField): void;
}

const ToolsContext = createContext<ToolsState | null>(null);

/**
 * One toolbar serves every text box in a message. Each box tells it when it is
 * focused, and the toolbar acts on the box that was focused last, so the
 * tools are always within reach and never repeated.
 */
export function ToolsProvider({ children }: { children: ReactNode }) {
  const [active, setActiveState] = useState<ActiveField | null>(null);
  const setActive = useCallback((field: ActiveField) => setActiveState(field), []);
  const release = useCallback((field: ActiveField) => setActiveState((current) => (current === field ? null : current)), []);
  const value = useMemo(() => ({ active, setActive, release }), [active, setActive, release]);
  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}

/**
 * Registers a text box with the toolbar, and puts text at the caret of the box,
 * or around what is selected. The box stays an ordinary controlled input.
 */
export function useToolTarget(value: string, setValue: (next: string) => void, label: string, reach: ToolReach = "full", variables?: readonly InsertVariable[]) {
  const ref = useRef<Field>(null);
  const tools = useContext(ToolsContext);

  const replace = (build: (selected: string) => string) => {
    const field = ref.current;
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    const inserted = build(value.slice(start, end));
    setValue(value.slice(0, start) + inserted + value.slice(end));
    // The caret has to land after the new text once React has written the value.
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + inserted.length, start + inserted.length);
    });
  };

  // The toolbar holds this object across renders, so it reads the latest closure through a ref
  // rather than the value the box had when it was focused.
  const latest = useRef({ insert: (text: string) => replace(() => text), wrap: (before: string, after = before) => replace((s) => `${before}${s}${after}`) });
  latest.current = { insert: (text) => replace(() => text), wrap: (before, after = before) => replace((s) => `${before}${s}${after}`) };

  const field = useMemo<ActiveField>(
    () => ({ label, reach, variables, insert: (text) => latest.current.insert(text), wrap: (before, after) => latest.current.wrap(before, after) }),
    [label, reach, variables],
  );

  const release = tools?.release;
  useEffect(() => {
    // A box that goes away must not stay the target, or the toolbar would write into whatever took its place.
    return () => release?.(field);
  }, [release, field]);

  // The usual editor shortcuts, so Ctrl+B in a message makes text bold the way it does elsewhere.
  const onKeyDown = (event: ReactKeyboardEvent<Field>) => {
    const marker = formatShortcut(event);
    if (marker === null) return;
    event.preventDefault();
    latest.current.wrap(marker);
  };

  return { ref, onFocus: () => tools?.setActive(field), onKeyDown };
}

/** The Markdown Ctrl+B, Ctrl+I and Ctrl+U stand for, or Cmd on a Mac; null for any other key. */
export function formatShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (event.altKey || event.shiftKey || event.ctrlKey === event.metaKey) return null;
  return FORMAT_KEYS[event.key.toLowerCase()] ?? null;
}

const FORMAT_KEYS: Record<string, string> = { b: "**", i: "*", u: "__" };

export type ToolTarget = ReturnType<typeof useToolTarget>;

/** A name the Variables tool offers, with what it becomes. */
export interface InsertVariable {
  name: string;
  description: string;
}

type MenuId = "variables" | "time" | "mention" | "emoji";

const FORMATS: { label: string; title: string; before: string; after?: string }[] = [
  { label: "B", title: "Bold", before: "**" },
  { label: "I", title: "Italic", before: "*" },
  { label: "U", title: "Underline", before: "__" },
  { label: "S", title: "Strikethrough", before: "~~" },
  { label: "</>", title: "Code", before: "`" },
  { label: "||", title: "Spoiler", before: "||" },
  { label: "”", title: "Quote", before: "> ", after: "" },
];

const COMMON_EMOJI = "😀 😂 😍 🥳 😎 🤔 😢 😡 👍 👎 👏 🙏 💪 🔥 ✨ 🎉 🎁 ❤️ 💜 💙 💚 💛 ⭐ ✅ ❌ ⚠️ ❗ ❓ 📢 📌 📅 🔔 🎮 🏆 🥇 🎵 🎬 📷 💬 👋 🚀 💡 🔒 🔑 🛠️ 📖 📝 🌟 ☕ 🍕 🐱 🐶 🌈 🌙 ☀️ ⚡ 💎 👑 🎯 📈 🏠 🔗 ➡️ ⬆️ ✔️ ➕ 🆕 🆗 🔴 🟢 🟡 🔵".split(" ");

const fetchJson = (url: string) => fetch(url).then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))));

interface ServerEmoji {
  id: string;
  name: string;
  animated: boolean;
  token: string;
  url: string;
}

/** The emoji a person can put in a message here, for text, buttons and reactions. */
export function EmojiGrid({ guildId, onPick }: { guildId: string; onPick(token: string): void }) {
  const { data } = useSWR<ServerEmoji[]>(`/api/guilds/${guildId}/messages/emojis`, fetchJson);
  return (
    <div className="insert-emoji">
      {data && data.length > 0 ? (
        <>
          <p className="insert-heading">This server</p>
          <div className="insert-emoji-grid">
            {data.map((emoji) => (
              <button key={emoji.id} type="button" className="insert-emoji-btn" title={`:${emoji.name}:`} aria-label={emoji.name} onClick={() => onPick(emoji.token)}>
                <img src={emoji.url} alt="" />
              </button>
            ))}
          </div>
        </>
      ) : null}
      <p className="insert-heading">Common</p>
      <div className="insert-emoji-grid">
        {COMMON_EMOJI.map((emoji) => (
          <button key={emoji} type="button" className="insert-emoji-btn" aria-label={emoji} onClick={() => onPick(emoji)}>
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

interface BarProps {
  guildId: string;
  /** Left out, the tool offers the variables every message has. */
  variables?: readonly InsertVariable[];
}

/**
 * The row of tools for the text box being edited: the formatting Discord
 * understands, then variables, a time, a mention and an emoji. It says which
 * box it is writing into, and turns off what that box could not show.
 */
export function ToolBar({ guildId, variables = MESSAGE_VARIABLES }: BarProps) {
  const tools = useContext(ToolsContext);
  const active = tools?.active ?? null;
  const [open, setOpen] = useState<MenuId | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (event.target instanceof Node && barRef.current?.contains(event.target)) return;
      setOpen(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Moving to a box that cannot take what a panel makes closes the panel.
  useEffect(() => {
    if (open && !allows(active?.reach, open)) setOpen(null);
  }, [active, open]);

  function pick(text: string) {
    active?.insert(text);
    setOpen(null);
  }

  // The buttons must not take focus from the box, or its caret and selection would be lost.
  const keepFocus = (event: ReactMouseEvent) => event.preventDefault();

  function menu(id: MenuId, label: string, panel: ReactNode, wide = false) {
    const enabled = allows(active?.reach, id);
    return (
      <div className="insert-menu">
        <button
          type="button"
          className="insert-btn"
          disabled={!enabled}
          aria-haspopup="true"
          aria-expanded={open === id}
          onMouseDown={keepFocus}
          onClick={() => setOpen(open === id ? null : id)}
        >
          {label}
        </button>
        {open === id ? <div className={wide ? "insert-panel insert-panel-wide" : "insert-panel"}>{panel}</div> : null}
      </div>
    );
  }

  const full = active?.reach === "full";

  return (
    <div className="insert-bar" ref={barRef} role="toolbar" aria-label="Add to the text">
      <p className="insert-target" aria-live="polite">
        {active ? (
          <>
            Adding to <strong>{active.label}</strong>
            {active.reach === "none" ? <span> — this box takes a web address</span> : null}
          </>
        ) : (
          "Click a text box, then use these"
        )}
      </p>
      <div className="insert-tools">
        <div className="insert-group">
          {FORMATS.map((format) => (
            <button
              key={format.title}
              type="button"
              className="insert-btn insert-format"
              disabled={!full}
              title={format.title}
              aria-label={format.title}
              onMouseDown={keepFocus}
              onClick={() => active?.wrap(format.before, format.after)}
            >
              {format.label}
            </button>
          ))}
        </div>
        <div className="insert-group">
          {menu("variables", "Variables", <VariablesPanel variables={active?.variables ?? variables} onPick={(name) => pick(`{${name}}`)} />)}
          {menu("time", "Time", <TimePanel onPick={pick} />, true)}
          {menu("mention", "Mention", <MentionPanel guildId={guildId} onPick={pick} />)}
          {menu("emoji", "Emoji", <EmojiGrid guildId={guildId} onPick={pick} />)}
        </div>
      </div>
    </div>
  );
}

function allows(reach: ToolReach | undefined, tool: MenuId): boolean {
  if (!reach || reach === "none") return false;
  if (reach === "full") return true;
  if (reach === "inline") return tool === "variables" || tool === "emoji";
  return tool === "variables";
}

function VariablesPanel({ variables, onPick }: { variables: readonly InsertVariable[]; onPick(name: string): void }) {
  return (
    <div className="insert-list">
      <p className="insert-heading">Filled in when the message is sent</p>
      {variables.map((variable) => (
        <button key={variable.name} type="button" className="insert-item" onClick={() => onPick(variable.name)}>
          <code>{`{${variable.name}}`}</code>
          <span>{variable.description}</span>
        </button>
      ))}
    </div>
  );
}

const QUICK_TIMES: { label: string; at: () => Date }[] = [
  { label: "In an hour", at: () => new Date(Date.now() + 3600_000) },
  {
    label: "Tomorrow, 9 AM",
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  {
    label: "Next week",
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(12, 0, 0, 0);
      return d;
    },
  },
];

/**
 * A date and time in the picker's own timezone, written as the token Discord
 * shows to each reader in theirs. Laid out in two columns so the whole thing,
 * Insert included, is on screen at once.
 */
function TimePanel({ onPick }: { onPick(token: string): void }) {
  const [value, setValue] = useState(() => localInput(new Date(Date.now() + 3600_000)));
  const [style, setStyle] = useState<TimestampStyle>("f");
  const date = new Date(value);
  const valid = !Number.isNaN(date.getTime());

  return (
    <div className="insert-time">
      <div className="insert-time-pick">
        <label className="field-label" htmlFor="insert-time-input">
          Date and time
        </label>
        <input id="insert-time-input" type="datetime-local" className="input" value={value} onChange={(event) => setValue(event.target.value)} />
        <div className="insert-quick">
          {QUICK_TIMES.map((quick) => (
            <button key={quick.label} type="button" className="chip-button" onClick={() => setValue(localInput(quick.at()))}>
              {quick.label}
            </button>
          ))}
        </div>
        <div className="insert-result" aria-live="polite">
          <span className="insert-heading">Readers will see</span>
          <strong>{valid ? formatDiscordTime(date, style) : "Pick a date"}</strong>
          <small>In their own timezone.</small>
        </div>
      </div>

      <div className="insert-time-styles" role="radiogroup" aria-label="How it is shown">
        {TIMESTAMP_STYLES.map((option) => (
          <button key={option.id} type="button" role="radio" aria-checked={style === option.id} className="insert-style" onClick={() => setStyle(option.id)}>
            <span>{option.label}</span>
            <small title={valid ? formatDiscordTime(date, option.id) : option.example}>{valid ? formatDiscordTime(date, option.id) : option.example}</small>
          </button>
        ))}
      </div>

      <button type="button" className="btn btn-primary btn-sm insert-time-go" disabled={!valid} onClick={() => onPick(discordTimestamp(date, style))}>
        Insert time
      </button>
    </div>
  );
}

function localInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function MentionPanel({ guildId, onPick }: { guildId: string; onPick(token: string): void }) {
  const { roles } = useRoles(guildId);
  const { channels } = useChannels(guildId);
  const [tab, setTab] = useState<"roles" | "channels" | "other">("roles");
  const [user, setUser] = useState("");
  const userOk = /^\d{17,20}$/.test(user.trim());

  return (
    <div className="insert-list">
      <div className="insert-tabs" role="tablist">
        {(["roles", "channels", "other"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="insert-tab" onClick={() => setTab(id)}>
            {id === "roles" ? "Role" : id === "channels" ? "Channel" : "Everyone, member"}
          </button>
        ))}
      </div>
      {tab === "roles"
        ? roles.map((role) => (
            <button key={role.id} type="button" className="insert-item" onClick={() => onPick(`<@&${role.id}>`)}>
              <span>@{role.name}</span>
            </button>
          ))
        : null}
      {tab === "channels"
        ? channels
            .filter((channel) => channel.type === 0 || channel.type === 5)
            .map((channel) => (
              <button key={channel.id} type="button" className="insert-item" onClick={() => onPick(`<#${channel.id}>`)}>
                <span>#{channel.name}</span>
              </button>
            ))
        : null}
      {tab === "other" ? (
        <>
          <button type="button" className="insert-item" onClick={() => onPick("@everyone")}>
            <code>@everyone</code>
            <span>Only pings when you allow it as you send</span>
          </button>
          <button type="button" className="insert-item" onClick={() => onPick("@here")}>
            <code>@here</code>
            <span>Only pings when you allow it as you send</span>
          </button>
          <div className="insert-user">
            <label className="field-label" htmlFor="insert-user-id">
              A member, by user ID
            </label>
            <input id="insert-user-id" className="input" placeholder="123456789012345678" value={user} onChange={(event) => setUser(event.target.value)} />
            <button type="button" className="btn btn-secondary btn-sm" disabled={!userOk} onClick={() => onPick(`<@${user.trim()}>`)}>
              Insert
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
