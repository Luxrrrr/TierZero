"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import type { MessageBody, ResponseTemplate } from "@tier0/core";
import {
  collectMessageRows,
  featureSearch,
  featureSummaries,
  filterRows,
  getAt,
  groupBySection,
  isSectionOpen,
  kindOf,
  KIND_LABEL,
  parseFeatureParam,
  resolveMostChanged,
  sectionsStartOpen,
  setAt,
  storedMessage,
  viewOf,
  type BotMessageRow,
  type FeatureSummary,
  type ModuleInput,
  type RowView,
} from "../lib/bot-messages";
import { messageSummary } from "../lib/message-summary";
import { SettingMessageDialog } from "./form/MessageControl";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, InfoIcon, MessagesIcon, SearchIcon } from "./Icons";
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
  /** The `feature` in the address, so a reload or a shared link lands in the same view. */
  initialFeature: string | null;
}

interface FieldError {
  path: string;
  message: string;
}

interface RowItemProps {
  row: BotMessageRow;
  view: RowView;
  busy: boolean;
  /** Set where rows from several features are mixed, so each says whose it is. */
  featureName?: string;
  onEdit(row: BotMessageRow, trigger: HTMLElement): void;
  onReset(row: BotMessageRow): void;
}

/** One message on one line: what it is, what it says now, and the buttons. When it is sent is a click away. */
function MessageRowItem({ row, view, busy, featureName, onEdit, onReset }: RowItemProps) {
  const [showWhen, setShowWhen] = useState(false);
  const infoRef = useRef<HTMLButtonElement>(null);
  const whenId = useId();
  const kind = kindOf(row.starting);
  const kindLabel = kind ? KIND_LABEL[kind] : null;
  const summary = messageSummary(view.body);

  return (
    <li
      className="bm-item"
      data-edited={view.edited ? "true" : undefined}
      data-off={row.moduleOff ? "true" : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !showWhen) return;
        event.stopPropagation();
        setShowWhen(false);
        infoRef.current?.focus();
      }}
    >
      <div className="bm-row">
        <span className="bm-dot" data-kind={kind ?? "none"} role={kindLabel ? "img" : undefined} aria-label={kindLabel ?? undefined} title={kindLabel ?? undefined} />
        <div className="bm-name">
          {featureName ? <span className="bm-prefix">{featureName}</span> : null}
          <span className="bm-label">{row.label}</span>
          {row.entry ? <span className="bm-entry">{row.entry}</span> : null}
          {view.edited ? <span className="bm-tag">Edited</span> : null}
        </div>
        <p className="bm-text" title={summary} data-default={view.edited ? undefined : "true"}>
          {summary}
        </p>
        <div className="bm-actions">
          {busy ? <span className="bm-saving">Saving…</span> : null}
          {row.help ? (
            <button
              ref={infoRef}
              type="button"
              className="bm-info"
              aria-label="When this is sent"
              aria-expanded={showWhen}
              aria-controls={whenId}
              onClick={() => setShowWhen(!showWhen)}
            >
              <InfoIcon />
            </button>
          ) : null}
          {view.edited ? (
            <button type="button" className="link-button" disabled={busy} onClick={() => onReset(row)}>
              Reset<span className="visually-hidden"> {row.label} to the default</span>
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary btn-sm" onClick={(event) => onEdit(row, event.currentTarget)}>
            Edit<span className="visually-hidden"> {row.label}</span>
          </button>
        </div>
      </div>
      {showWhen && row.help ? (
        <p className="bm-when" id={whenId}>
          {row.help}
        </p>
      ) : null}
    </li>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Every message the bot can send on a server. It opens on a card for each
 * feature, a feature opens as its messages in groups, and a search lists matches
 * from all features at once. A message is edited here with the same editor as on
 * its feature's page, and saved the same way: the feature's whole settings go
 * back with the one message replaced, so the bot is using the new wording as
 * soon as the save is acknowledged.
 */
export function BotMessagesBrowser({ guildId, modules, initialFeature }: Props) {
  const { push } = useToast();
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>(() =>
    Object.fromEntries(modules.map((module) => [module.id, module.settings])),
  );
  const [replies, setReplies] = useState<Record<string, MessageBody | null>>(() =>
    Object.fromEntries(modules.flatMap((module) => module.commands).map((command) => [command.name, command.customReply])),
  );
  const [query, setQuery] = useState("");
  const [featureParam, setFeatureParam] = useState<string | null>(initialFeature);
  const [editedOnly, setEditedOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  // Sections the owner opened or closed by hand, by feature and group.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const searchRef = useRef<HTMLInputElement>(null);
  // Where focus goes back to when the editor closes, so keyboard use is not left at the top of the page.
  const returnFocus = useRef<HTMLElement | null>(null);
  // Where focus goes after moving between the cards and a feature.
  const focusAfterMove = useRef<string | null>(null);
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

  const features = useMemo(() => featureSummaries(rows, views, modules), [rows, views, modules]);
  const featureIds = useMemo(() => features.map((feature) => feature.id), [features]);
  const featureId = parseFeatureParam(featureParam, featureIds);
  const feature = features.find((entry) => entry.id === featureId);
  const editedCount = useMemo(() => rows.filter((row) => views.get(row.key)?.edited).length, [rows, views]);

  const searching = query.trim() !== "";
  const matches = useMemo(() => {
    if (!searching) return [];
    const rank = new Map(featureIds.map((id, index) => [id, index]));
    return filterRows(rows, views, { query, moduleId: null, editedOnly }).sort((a, b) => (rank.get(a.moduleId) ?? 0) - (rank.get(b.moduleId) ?? 0));
  }, [searching, rows, views, query, editedOnly, featureIds]);

  const featureRows = useMemo(
    () => (featureId === null ? [] : filterRows(rows, views, { query: "", moduleId: featureId, editedOnly })),
    [rows, views, featureId, editedOnly],
  );
  const sections = useMemo(() => groupBySection(featureRows, views), [featureRows, views]);
  const startOpen = feature ? sectionsStartOpen(feature.total) : true;

  const cards = useMemo(() => (editedOnly ? features.filter((entry) => entry.edited > 0) : features), [features, editedOnly]);
  const quick = useMemo(() => resolveMostChanged(rows, views, editedOnly), [rows, views, editedOnly]);

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

  // The back and forward buttons move between the cards and a feature.
  useEffect(() => {
    function onPop() {
      setFeatureParam(new URLSearchParams(window.location.search).get("feature"));
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const target = focusAfterMove.current;
    if (target === null) return;
    focusAfterMove.current = null;
    document.getElementById(target)?.focus();
  }, [featureId]);

  function go(next: string | null, event?: MouseEvent) {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
    event?.preventDefault();
    focusAfterMove.current = next === null ? (featureId === null ? null : `bm-card-${featureId}`) : "bm-feature-title";
    window.history.pushState(null, "", `${window.location.pathname}${featureSearch(next)}`);
    setFeatureParam(next);
    window.scrollTo({ top: 0 });
  }

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

  const editingRow = editing === null ? undefined : rows.find((row) => row.key === editing);
  const editingView = editingRow ? views.get(editingRow.key) : undefined;

  function rowItem(row: BotMessageRow, withFeature: boolean) {
    const view = views.get(row.key);
    if (!view) return null;
    return (
      <MessageRowItem
        key={row.key}
        row={row}
        view={view}
        busy={saving.has(row.key)}
        {...(withFeature ? { featureName: row.moduleName } : {})}
        onEdit={open}
        onReset={reset}
      />
    );
  }

  function emptyState(title: string, text: string, action?: { label: string; run(): void }) {
    return (
      <div className="empty">
        <MessagesIcon className="empty-icon" />
        <p className="empty-title">{title}</p>
        <p className="empty-text">{text}</p>
        {action ? (
          <div className="empty-actions">
            <button type="button" className="btn btn-secondary" onClick={action.run}>
              {action.label}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const noneEdited = () => emptyState("Nothing changed yet", "You haven't changed any messages yet. Everything is using the default wording.", { label: "Show all messages", run: () => setEditedOnly(false) });

  function renderCard(entry: FeatureSummary) {
    return (
      <li key={entry.id}>
        <a
          id={`bm-card-${entry.id}`}
          className="card bm-card"
          href={featureSearch(entry.id)}
          data-off={entry.off ? "true" : undefined}
          onClick={(event) => go(entry.id, event)}
        >
          <span className="bm-card-head">
            <span className="bm-card-name">{entry.name}</span>
            {entry.off ? <span className="badge badge-off">Off</span> : null}
            <ChevronRightIcon className="bm-card-arrow" />
          </span>
          {entry.summary ? <span className="bm-card-summary">{entry.summary}</span> : null}
          <span className="bm-card-meta">
            {plural(entry.total, "message", "messages")}
            {entry.edited > 0 ? <span className="bm-edited">{` · ${entry.edited} edited`}</span> : null}
          </span>
        </a>
      </li>
    );
  }

  function renderFeature(current: FeatureSummary) {
    const module = byModule.get(current.id);
    const allClosed = sections.every((section) => !isSectionOpen(toggled[`${current.id}/${section.title}`], startOpen, editedOnly));
    return (
      <>
        <div className="bm-feature-head">
          <a className="bm-back" href={featureSearch(null) || "?"} onClick={(event) => go(null, event)}>
            <ChevronLeftIcon />
            All features
          </a>
          <div className="bm-feature-main">
            <div className="bm-feature-text">
              <h2 className="bm-feature-title" id="bm-feature-title" tabIndex={-1}>
                {current.name}
              </h2>
              <p className="bm-feature-meta">
                {plural(current.total, "message", "messages")}
                {current.edited > 0 ? <span className="bm-edited">{` · ${current.edited} edited`}</span> : null}
                {current.off ? <span className="badge badge-off">Off</span> : null}
              </p>
            </div>
            <div className="bm-feature-actions">
              {sections.length > 1 ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setToggled((state) => ({ ...state, ...Object.fromEntries(sections.map((section) => [`${current.id}/${section.title}`, allClosed])) }))}
                >
                  {allClosed ? "Expand all" : "Collapse all"}
                </button>
              ) : null}
              {module ? (
                <Link className="btn btn-secondary btn-sm" href={module.href}>
                  Open {current.name} settings
                </Link>
              ) : null}
            </div>
          </div>
        </div>
        {current.off ? <p className="bm-note">This feature is off. You can edit its messages now, and they are used once you turn it on.</p> : null}

        {sections.length === 0 ? (
          editedOnly ? (
            noneEdited()
          ) : (
            emptyState("No messages here", "This feature has no messages to edit.")
          )
        ) : (
          <div className="bm-sections" data-off={current.off ? "true" : undefined}>
            {sections.map((section) => {
              const key = `${current.id}/${section.title}`;
              const isOpen = isSectionOpen(toggled[key], startOpen, editedOnly);
              const listId = `bm-sec-${current.id}-${sections.indexOf(section)}`;
              return (
                <section key={key} className="card bm-section">
                  <h3 className="bm-section-heading">
                    <button
                      type="button"
                      className="bm-section-toggle"
                      aria-expanded={isOpen}
                      aria-controls={listId}
                      onClick={() => setToggled((state) => ({ ...state, [key]: !isOpen }))}
                    >
                      <ChevronDownIcon className="bm-chevron" />
                      <span className="bm-section-title">{section.title}</span>
                      <span className="bm-count-pill">{section.rows.length}</span>
                      {section.edited > 0 ? <span className="bm-edited">{`· ${section.edited} edited`}</span> : null}
                    </button>
                  </h3>
                  {isOpen ? (
                    <ul className="bm-rows" id={listId}>
                      {section.rows.map((row) => rowItem(row, false))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </>
    );
  }

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
          <button type="button" className="cmd-chip" aria-pressed={editedOnly} onClick={() => setEditedOnly(!editedOnly)}>
            Edited only
            <span className="cmd-chip-count">{editedCount}</span>
          </button>
        </div>
      </div>

      {searching ? (
        <>
          <p className="bm-count" role="status">
            {plural(matches.length, "match", "matches")}
          </p>
          {matches.length === 0 ? (
            emptyState(
              "No message matches that",
              "Search looks at a message's name, when it is sent, its feature and the words it says now. Try a shorter word, or clear the search.",
              { label: "Clear search", run: () => setQuery("") },
            )
          ) : (
            <div className="card bm-section">
              <ul className="bm-rows">{matches.map((row) => rowItem(row, true))}</ul>
            </div>
          )}
        </>
      ) : feature ? (
        renderFeature(feature)
      ) : (
        <>
          {quick.length > 0 ? (
            <section className="bm-quick" aria-labelledby="bm-quick-title">
              <h2 className="bm-heading" id="bm-quick-title">
                Most changed
              </h2>
              <ul className="bm-chips">
                {quick.map((item) => (
                  <li key={item.row.key}>
                    <button
                      type="button"
                      className="bm-chip"
                      data-edited={views.get(item.row.key)?.edited ? "true" : undefined}
                      onClick={(event) => open(item.row, event.currentTarget)}
                    >
                      <span className="bm-chip-label">{item.label}</span>
                      <span className="bm-chip-feature">{item.row.moduleName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <h2 className="bm-heading" id="bm-features-title">
            Features
          </h2>
          {cards.length === 0 ? (
            editedOnly ? (
              noneEdited()
            ) : (
              emptyState("No messages", "None of the features on this server has a message to edit.")
            )
          ) : (
            <ul className="bm-cards" aria-labelledby="bm-features-title">
              {cards.map(renderCard)}
            </ul>
          )}
        </>
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
                  help={editingRow.help}
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
                help={editingRow.help}
                customized={editingView.edited ? storedMessage(getAt(settings[editingRow.moduleId], editingRow.segments)) : null}
                onChange={(next) => saveSetting(editingRow, next)}
                onClose={close}
              />
            )
        : null}
    </>
  );
}
