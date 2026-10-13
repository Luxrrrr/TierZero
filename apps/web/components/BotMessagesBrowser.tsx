"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { MessageBody, ResponseTemplate } from "@tier0/core";
import {
  collectMessageRows,
  countByModule,
  filterRows,
  getAt,
  groupByModule,
  setAt,
  storedMessage,
  viewOf,
  type BotMessageRow,
  type ModuleInput,
  type RowView,
} from "../lib/bot-messages";
import { messageSummary } from "../lib/message-summary";
import { Select } from "./form";
import { SettingMessageDialog } from "./form/MessageControl";
import { MessagesIcon, SearchIcon } from "./Icons";
import { ReplyEditor } from "./messages/ReplyEditor";
import { useToast } from "./Toaster";

export interface BrowserCommand {
  name: string;
  kind: "slash" | "user" | "message";
  response: ResponseTemplate | null;
  privateByDefault: boolean;
  /** Whether the owner chose private or public for it, or null to keep the command's own. */
  ephemeral: boolean | null;
  customReply: MessageBody | null;
}

export interface BrowserModule extends Omit<ModuleInput, "commands"> {
  settings: Record<string, unknown>;
  /** Where this feature's settings are, without a group. */
  href: string;
  commands: BrowserCommand[];
}

interface Props {
  guildId: string;
  modules: BrowserModule[];
}

const ALL = "all";

interface FieldError {
  path: string;
  message: string;
}

/**
 * Every message the bot can send on a server, in one searchable list. A message
 * is edited here with the same editor as on its feature's page, and saved the
 * same way: the feature's whole settings go back with the one message replaced,
 * so the bot is using the new wording as soon as the save is acknowledged.
 */
export function BotMessagesBrowser({ guildId, modules }: Props) {
  const { push } = useToast();
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>(() =>
    Object.fromEntries(modules.map((module) => [module.id, module.settings])),
  );
  const [replies, setReplies] = useState<Record<string, MessageBody | null>>(() =>
    Object.fromEntries(modules.flatMap((module) => module.commands).map((command) => [command.name, command.customReply])),
  );
  const [query, setQuery] = useState("");
  const [moduleId, setModuleId] = useState(ALL);
  const [editedOnly, setEditedOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());

  const searchRef = useRef<HTMLInputElement>(null);
  // Where focus goes back to when the editor closes, so keyboard use is not left at the top of the page.
  const returnFocus = useRef<HTMLElement | null>(null);
  // Edits are applied to the latest copy, and saved one after another per feature, so two quick edits cannot overwrite each other.
  const latest = useRef(settings);
  const queues = useRef(new Map<string, Promise<void>>());

  const byModule = useMemo(() => new Map(modules.map((module) => [module.id, module])), [modules]);
  const commandsByName = useMemo(
    () => new Map(modules.flatMap((module) => module.commands).map((command) => [command.name, command])),
    [modules],
  );

  const rows = useMemo(() => collectMessageRows(modules, settings), [modules, settings]);
  const views = useMemo(() => {
    const map = new Map<string, RowView>();
    for (const row of rows) map.set(row.key, viewOf(row, settings, replies));
    return map;
  }, [rows, settings, replies]);

  const shown = useMemo(
    () => filterRows(rows, views, { query, moduleId: moduleId === ALL ? null : moduleId, editedOnly }),
    [rows, views, query, moduleId, editedOnly],
  );
  const groups = useMemo(() => groupByModule(shown), [shown]);
  const editedCount = useMemo(() => rows.filter((row) => views.get(row.key)?.edited).length, [rows, views]);

  const moduleOptions = useMemo(() => {
    const counts = countByModule(rows);
    return [
      { value: ALL, label: `All features (${rows.length})` },
      ...modules.filter((module) => counts.has(module.id)).map((module) => ({ value: module.id, label: `${module.name} (${counts.get(module.id)})` })),
    ];
  }, [modules, rows]);

  // "/" jumps to the search, the way it does on the Commands page.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const mark = useCallback((key: string, on: boolean) => {
    setSaving((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const applySetting = useCallback((id: string, segments: BotMessageRow["segments"], value: unknown) => {
    const next = { ...latest.current, [id]: setAt(latest.current[id] ?? {}, segments, value) };
    latest.current = next;
    setSettings(next);
  }, []);

  const saveSetting = useCallback(
    (row: BotMessageRow, message: MessageBody | undefined) => {
      const before = getAt(latest.current[row.moduleId], row.segments);
      applySetting(row.moduleId, row.segments, message);
      mark(row.key, true);

      const send = async () => {
        try {
          const res = await fetch(`/api/guilds/${guildId}/modules/${row.moduleId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ settings: latest.current[row.moduleId] }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string; errors?: FieldError[] };
            throw new Error(body.errors?.[0]?.message ?? body.error ?? "The bot did not accept this message. Try again.");
          }
          push({ kind: "success", title: "Saved. The bot is already using the new settings." });
        } catch (error) {
          // Only this message goes back, so an edit made to another one meanwhile survives.
          applySetting(row.moduleId, row.segments, before);
          push({
            kind: "error",
            title: `${row.label} was not saved`,
            detail: error instanceof TypeError ? "The dashboard could not be reached. Check your connection, then try again." : (error as Error).message,
          });
        } finally {
          mark(row.key, false);
        }
      };

      const previous = queues.current.get(row.moduleId) ?? Promise.resolve();
      queues.current.set(row.moduleId, previous.then(send));
    },
    [applySetting, guildId, mark, push],
  );

  const saveReply = useCallback(
    async (row: BotMessageRow, message: MessageBody | null) => {
      const name = row.command;
      if (name === null) return;
      const before = replies[name] ?? null;
      setReplies((current) => ({ ...current, [name]: message }));
      mark(row.key, true);
      try {
        const res = await fetch(`/api/guilds/${guildId}/commands/${encodeURIComponent(name)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ customReply: message }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "The bot did not accept this reply. Try again.");
        }
        push({ kind: "success", title: "Saved. The bot is already using the new settings." });
      } catch (error) {
        setReplies((current) => ({ ...current, [name]: before }));
        push({
          kind: "error",
          title: `${row.label} was not saved`,
          detail: error instanceof TypeError ? "The dashboard could not be reached. Check your connection, then try again." : (error as Error).message,
        });
      } finally {
        mark(row.key, false);
      }
    },
    [guildId, mark, push, replies],
  );

  function open(row: BotMessageRow, trigger: HTMLElement) {
    returnFocus.current = trigger;
    setEditing(row.key);
  }

  function close() {
    setEditing(null);
    returnFocus.current?.focus();
  }

  function reset(row: BotMessageRow) {
    if (row.kind === "reply") void saveReply(row, null);
    else saveSetting(row, undefined);
  }

  function clearFilters() {
    setQuery("");
    setModuleId(ALL);
    setEditedOnly(false);
  }

  const filtering = query.trim() !== "" || moduleId !== ALL || editedOnly;
  const editingRow = editing === null ? undefined : rows.find((row) => row.key === editing);
  const editingView = editingRow ? views.get(editingRow.key) : undefined;

  return (
    <>
      <div className="cmd-toolbar bm-toolbar">
        <div className="search">
          <SearchIcon />
          <input
            ref={searchRef}
            type="search"
            className="input"
            value={query}
            placeholder="Search messages"
            aria-label="Search messages"
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="cmd-kbd" aria-hidden="true">
            /
          </kbd>
        </div>
        <div className="bm-filters">
          <Select
            className="bm-select"
            size="sm"
            options={moduleOptions}
            value={moduleId}
            onChange={setModuleId}
            aria-label="Show messages from"
          />
          <button type="button" className="cmd-chip" aria-pressed={editedOnly} onClick={() => setEditedOnly(!editedOnly)}>
            Edited only
            <span className="cmd-chip-count">{editedCount}</span>
          </button>
        </div>
      </div>

      <p className="bm-count" role="status">
        {shown.length === rows.length
          ? `${rows.length} ${rows.length === 1 ? "message" : "messages"}`
          : `${shown.length} of ${rows.length} messages`}
      </p>

      {shown.length === 0 ? (
        <div className="empty">
          <MessagesIcon className="empty-icon" />
          <p className="empty-title">{editedOnly && query.trim() === "" && moduleId === ALL ? "You have not edited any message yet" : "No message matches that"}</p>
          <p className="empty-text">
            {editedOnly && query.trim() === "" && moduleId === ALL
              ? "Every message here still says what the bot says out of the box. Turn off Edited only to see them all."
              : "Search looks at a message's name, when it is sent, its feature and the words it says now. Try a shorter word, or clear the search and the filters."}
          </p>
          {filtering ? (
            <div className="empty-actions">
              <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                Show everything
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="bm-list">
          {groups.map((group) => {
            const module = byModule.get(group.moduleId);
            return (
              <section key={group.moduleId} className="card bm-group" aria-labelledby={`bm-${group.moduleId}`} data-off={group.off ? "true" : undefined}>
                <div className="bm-group-head">
                  <h2 className="bm-group-title" id={`bm-${group.moduleId}`}>
                    {group.moduleName}
                  </h2>
                  <span className="bm-group-count">{group.rows.length}</span>
                  {group.off ? <span className="badge badge-off">Off</span> : null}
                  {module ? (
                    <Link className="bm-group-link" href={module.href}>
                      Open settings<span className="visually-hidden"> for {group.moduleName}</span>
                    </Link>
                  ) : null}
                </div>
                {group.off ? (
                  <p className="bm-group-note">This feature is off. You can edit its messages now; they are used once you turn it on.</p>
                ) : null}
                <ul className="bm-rows">
                  {group.rows.map((row) => {
                    const view = views.get(row.key);
                    if (!view) return null;
                    const summary = messageSummary(view.body);
                    const busy = saving.has(row.key);
                    const settingsHref = row.kind === "reply" ? `/guilds/${guildId}/commands` : `${module?.href ?? ""}${row.anchor ? `#${row.anchor}` : ""}`;
                    const where = row.kind === "reply" ? "Commands" : `${group.moduleName} settings`;
                    return (
                      <li key={row.key} className="bm-row" data-edited={view.edited ? "true" : undefined}>
                        <div className="bm-main">
                          <div className="bm-title">
                            <h3 className="bm-label">{row.label}</h3>
                            {view.edited ? <span className="bm-tag">Edited</span> : null}
                            {busy ? <span className="bm-saving">Saving…</span> : null}
                          </div>
                          {row.trail.length > 0 ? <p className="bm-trail">{row.trail.join(" › ")}</p> : null}
                          {row.help ? <p className="bm-help">{row.help}</p> : null}
                        </div>
                        <p className="bm-text" title={summary} data-default={view.edited ? undefined : "true"}>
                          {summary}
                        </p>
                        <div className="bm-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={(event) => open(row, event.currentTarget)}>
                            Edit message
                            <span className="visually-hidden"> {row.label}</span>
                          </button>
                          {view.edited ? (
                            <button type="button" className="link-button" disabled={busy} onClick={() => reset(row)}>
                              Go back to the default
                              <span className="visually-hidden"> for {row.label}</span>
                            </button>
                          ) : null}
                          <Link className="bm-link" href={settingsHref}>
                            Open in {where}
                            <span className="visually-hidden"> for {row.label}</span>
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {editingRow && editingView
        ? editingRow.kind === "reply"
          ? (() => {
              const command = editingRow.command === null ? undefined : commandsByName.get(editingRow.command);
              if (!command?.response) return null;
              const current = replies[command.name] ?? null;
              return (
                <ReplyEditor
                  guildId={guildId}
                  commandName={editingRow.label}
                  template={command.response}
                  current={current}
                  isPrivate={command.ephemeral ?? command.privateByDefault}
                  onSave={(message) => {
                    void saveReply(editingRow, message);
                    close();
                  }}
                  onReset={() => {
                    void saveReply(editingRow, null);
                    close();
                  }}
                  onClose={close}
                />
              );
            })()
          : (
              <SettingMessageDialog
                guildId={guildId}
                label={editingRow.label}
                starting={editingRow.starting}
                variables={editingRow.variables}
                delivery={editingRow.delivery}
                components={editingRow.components}
                note={editingRow.note}
                customized={editingView.edited ? storedMessage(getAt(settings[editingRow.moduleId], editingRow.segments)) : null}
                onChange={(next) => saveSetting(editingRow, next)}
                onClose={close}
              />
            )
        : null}
    </>
  );
}
