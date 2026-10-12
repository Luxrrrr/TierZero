"use client";

import { useCallback, useMemo, useState } from "react";
import {
  MESSAGE_LIMITS,
  discordTimestamp,
  parseMessage,
  type MessageButton,
  type MessageEmbed,
  type MessageSelect,
  type MessageError,
  type MessageFolderDto,
  type MessageLibrary,
  type MessageTemplateDto,
} from "@tier0/core";
import { Combobox } from "../form";
import { ChevronDownIcon, FolderIcon, MessagesIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon } from "../Icons";
import { MessageForm } from "./MessageForm";
import { MessagePreview, type PreviewContext } from "./MessagePreview";
import { SendDialog } from "./SendDialog";

interface Props {
  guildId: string;
  guildName: string;
  memberCount: number;
  initial: MessageLibrary;
  botName: string;
}

interface Draft {
  name: string;
  folderId: number | null;
  content: string;
  embeds: MessageEmbed[];
  buttons: MessageButton[];
  selects: MessageSelect[];
  reactions: string[];
}

const BLANK: Draft = { name: "", folderId: null, content: "", embeds: [], buttons: [], selects: [], reactions: [] };
const NO_FOLDER = "none";
const SAVED_LINGER_MS = 2500;

type Notice = { kind: "ok" | "error"; text: string } | null;

const snapshot = (draft: Draft) => JSON.stringify(draft);
const draftOf = (template: MessageTemplateDto): Draft => ({
  name: template.name,
  folderId: template.folderId,
  content: template.content,
  embeds: template.embeds,
  buttons: template.buttons,
  selects: template.selects,
  reactions: template.reactions,
});

/**
 * The message builder. The library of templates is on the left, one message is
 * edited in the middle, and what it will look like in Discord is drawn beside
 * it. Nothing is sent until the Send dialog is confirmed, and a saved template
 * is only ever changed by pressing Save.
 */
export function MessagesStudio({ guildId, guildName, memberCount, initial, botName }: Props) {
  const [library, setLibrary] = useState<MessageLibrary>(initial);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [baseline, setBaseline] = useState<string>(snapshot(BLANK));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);

  const dirty = snapshot(draft) !== baseline;
  const parsed = useMemo(
    () => parseMessage({ content: draft.content, embeds: draft.embeds, buttons: draft.buttons, selects: draft.selects, reactions: draft.reactions }),
    [draft.content, draft.embeds, draft.buttons, draft.selects, draft.reactions],
  );
  // Stand-ins for what the bot fills in at send time, so the preview reads like the real message.
  const previewContext = useMemo<PreviewContext>(() => {
    const now = new Date();
    return {
      guildId,
      botName,
      variables: {
        server: guildName,
        members: memberCount.toLocaleString("en-US"),
        channel: "#channel",
        "channel.name": "channel",
        date: discordTimestamp(now, "D"),
        time: discordTimestamp(now, "t"),
        now: discordTimestamp(now, "f"),
        sender: "You",
        bot: botName,
      },
    };
  }, [guildId, guildName, memberCount, botName]);
  const errors: MessageError[] = parsed.ok ? [] : parsed.errors;
  const nothingYet = draft.content.trim() === "" && draft.embeds.length === 0 && draft.buttons.length === 0 && draft.reactions.length === 0;
  const shownErrors = nothingYet ? [] : errors;

  const call = useCallback(
    async (method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: unknown; error: string }> => {
      try {
        const res = await fetch(`/api/guilds/${guildId}/messages${path ? `/${path}` : ""}`, {
          method,
          headers: body === undefined ? undefined : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: res.ok, data, error: res.ok ? "" : (data.error ?? "That did not work. Try again.") };
      } catch {
        return { ok: false, data: null, error: "The dashboard could not reach the bot. Check that it is running, then try again." };
      }
    },
    [guildId],
  );

  function flash(next: Notice) {
    setNotice(next);
    if (next?.kind === "ok") window.setTimeout(() => setNotice((current) => (current === next ? null : current)), SAVED_LINGER_MS);
  }

  /** Leaving a message with unsaved edits asks first, because nothing else would bring them back. */
  function confirmLeave(): boolean {
    return !dirty || window.confirm("You have changes that are not saved. Discard them?");
  }

  function open(template: MessageTemplateDto) {
    if (template.id === selectedId || !confirmLeave()) return;
    const next = draftOf(template);
    setSelectedId(template.id);
    setDraft(next);
    setBaseline(snapshot(next));
    setNotice(null);
  }

  function startNew(folderId: number | null = null) {
    if (!confirmLeave()) return;
    const next = { ...BLANK, folderId };
    setSelectedId(null);
    setDraft(next);
    setBaseline(snapshot(BLANK));
    setNotice(null);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    const body = { name: draft.name, folderId: draft.folderId, content: draft.content, embeds: draft.embeds, buttons: draft.buttons, selects: draft.selects, reactions: draft.reactions };
    const result = await call(selectedId === null ? "POST" : "PATCH", selectedId === null ? "templates" : `templates/${selectedId}`, body);
    setBusy(false);
    if (!result.ok) return flash({ kind: "error", text: result.error });
    const saved = result.data as MessageTemplateDto;
    setLibrary((current) => ({
      ...current,
      templates: [...current.templates.filter((t) => t.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)),
    }));
    setSelectedId(saved.id);
    setBaseline(snapshot(draftOf(saved)));
    setDraft(draftOf(saved));
    flash({ kind: "ok", text: "Saved" });
  }

  async function duplicate() {
    if (busy || !parsed.ok) return;
    setBusy(true);
    const name = `${draft.name || "Untitled"} copy`.slice(0, MESSAGE_LIMITS.templateName);
    const result = await call("POST", "templates", { name, folderId: draft.folderId, content: draft.content, embeds: draft.embeds, buttons: draft.buttons, selects: draft.selects, reactions: draft.reactions });
    setBusy(false);
    if (!result.ok) return flash({ kind: "error", text: result.error });
    const saved = result.data as MessageTemplateDto;
    setLibrary((current) => ({ ...current, templates: [...current.templates, saved].sort((a, b) => a.name.localeCompare(b.name)) }));
    setSelectedId(saved.id);
    setDraft(draftOf(saved));
    setBaseline(snapshot(draftOf(saved)));
    flash({ kind: "ok", text: "Copied" });
  }

  async function remove() {
    if (selectedId === null || busy) return;
    if (!window.confirm(`Delete "${draft.name}"? This can't be undone.`)) return;
    setBusy(true);
    const result = await call("DELETE", `templates/${selectedId}`);
    setBusy(false);
    if (!result.ok) return flash({ kind: "error", text: result.error });
    setLibrary((current) => ({ ...current, templates: current.templates.filter((t) => t.id !== selectedId) }));
    setSelectedId(null);
    setDraft(BLANK);
    setBaseline(snapshot(BLANK));
    flash({ kind: "ok", text: "Deleted" });
  }

  async function createFolder() {
    const name = (newFolder ?? "").trim();
    if (name === "") return setNewFolder(null);
    const result = await call("POST", "folders", { name });
    if (!result.ok) return flash({ kind: "error", text: result.error });
    const folder = result.data as MessageFolderDto;
    setLibrary((current) => ({ ...current, folders: [...current.folders, folder].sort((a, b) => a.name.localeCompare(b.name)) }));
    setNewFolder(null);
  }

  async function renameFolder() {
    if (!renaming) return;
    const result = await call("PATCH", `folders/${renaming.id}`, { name: renaming.name });
    if (!result.ok) return flash({ kind: "error", text: result.error });
    const folder = result.data as MessageFolderDto;
    setLibrary((current) => ({
      ...current,
      folders: current.folders.map((f) => (f.id === folder.id ? folder : f)).sort((a, b) => a.name.localeCompare(b.name)),
    }));
    setRenaming(null);
  }

  async function deleteFolder(folder: MessageFolderDto) {
    const inside = library.templates.filter((t) => t.folderId === folder.id).length;
    const note = inside > 0 ? ` Its ${inside} ${inside === 1 ? "template moves" : "templates move"} out of the folder, and nothing is deleted.` : "";
    if (!window.confirm(`Delete the folder "${folder.name}"?${note}`)) return;
    const result = await call("DELETE", `folders/${folder.id}`);
    if (!result.ok) return flash({ kind: "error", text: result.error });
    setLibrary((current) => ({
      folders: current.folders.filter((f) => f.id !== folder.id),
      templates: current.templates.map((t) => (t.folderId === folder.id ? { ...t, folderId: null } : t)),
    }));
    setDraft((current) => (current.folderId === folder.id ? { ...current, folderId: null } : current));
    setBaseline((current) => {
      try {
        const base = JSON.parse(current) as Draft;
        return snapshot(base.folderId === folder.id ? { ...base, folderId: null } : base);
      } catch {
        return current;
      }
    });
  }

  const needle = query.trim().toLowerCase();
  const visible = library.templates.filter((t) => needle === "" || t.name.toLowerCase().includes(needle));
  const unfiled = visible.filter((t) => t.folderId === null);

  function row(template: MessageTemplateDto) {
    const kind =
      template.embeds.length > 0
        ? `${template.embeds.length} ${template.embeds.length === 1 ? "embed" : "embeds"}`
        : "Text";
    return (
      <li key={template.id}>
        <button
          type="button"
          className="msg-template"
          aria-current={template.id === selectedId ? "true" : undefined}
          onClick={() => open(template)}
        >
          <MessagesIcon />
          <span className="msg-template-name">{template.name}</span>
          <span className="msg-template-meta">{kind}</span>
        </button>
      </li>
    );
  }

  const folderOptions = [
    { value: NO_FOLDER, label: "No folder" },
    ...library.folders.map((folder) => ({ value: String(folder.id), label: folder.name })),
  ];

  const canSave = !busy && dirty && draft.name.trim() !== "" && parsed.ok;
  const canSend = parsed.ok;

  return (
    <div className="msg-studio">
      <aside className="msg-library card" aria-label="Templates">
        <div className="msg-library-head">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => startNew()}>
            <PlusIcon /> New message
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewFolder("")}>
            <FolderIcon /> New folder
          </button>
        </div>

        <div className="search msg-search">
          <SearchIcon />
          <input
            type="search"
            className="input"
            placeholder="Search templates"
            aria-label="Search templates"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="msg-library-list">
          {newFolder !== null ? (
            <form
              className="msg-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void createFolder();
              }}
            >
              <input
                className="input"
                autoFocus
                aria-label="Folder name"
                placeholder="Folder name"
                maxLength={MESSAGE_LIMITS.folderName}
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setNewFolder(null);
                }}
              />
              <button type="submit" className="btn btn-secondary btn-sm">
                Add
              </button>
            </form>
          ) : null}

          {library.templates.length === 0 && library.folders.length === 0 ? (
            <p className="msg-empty">
              Templates you save show up here. Build a message, give it a name and press Save.
            </p>
          ) : null}

          {unfiled.length > 0 ? <ul className="msg-templates">{unfiled.map(row)}</ul> : null}

          {library.folders.map((folder) => {
            const inside = visible.filter((t) => t.folderId === folder.id);
            if (needle !== "" && inside.length === 0) return null;
            const isCollapsed = collapsed.has(folder.id) && needle === "";
            return (
              <section key={folder.id} className="msg-folder">
                {renaming?.id === folder.id ? (
                  <form
                    className="msg-inline-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameFolder();
                    }}
                  >
                    <input
                      className="input"
                      autoFocus
                      aria-label="Folder name"
                      maxLength={MESSAGE_LIMITS.folderName}
                      value={renaming.name}
                      onChange={(event) => setRenaming({ id: folder.id, name: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setRenaming(null);
                      }}
                    />
                    <button type="submit" className="btn btn-secondary btn-sm">
                      Save
                    </button>
                  </form>
                ) : (
                  <div className="msg-folder-head">
                    <button
                      type="button"
                      className="msg-folder-toggle"
                      aria-expanded={!isCollapsed}
                      onClick={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (next.has(folder.id)) next.delete(folder.id);
                          else next.add(folder.id);
                          return next;
                        })
                      }
                    >
                      <ChevronDownIcon className="msg-folder-chevron" />
                      <FolderIcon />
                      <span className="msg-folder-name">{folder.name}</span>
                      <span className="msg-folder-count">{library.templates.filter((t) => t.folderId === folder.id).length}</span>
                    </button>
                    <span className="msg-folder-tools">
                      <button type="button" className="icon-btn" aria-label={`New message in ${folder.name}`} onClick={() => startNew(folder.id)}>
                        <PlusIcon />
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Rename ${folder.name}`} onClick={() => setRenaming({ id: folder.id, name: folder.name })}>
                        <PencilIcon />
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Delete ${folder.name}`} onClick={() => void deleteFolder(folder)}>
                        <TrashIcon />
                      </button>
                    </span>
                  </div>
                )}
                {!isCollapsed ? (
                  inside.length > 0 ? (
                    <ul className="msg-templates">{inside.map(row)}</ul>
                  ) : (
                    <p className="msg-empty msg-empty-folder">Empty. Pick this folder when you save a template.</p>
                  )
                ) : null}
              </section>
            );
          })}

          {needle !== "" && visible.length === 0 ? <p className="msg-empty">No template matches that.</p> : null}
        </div>
      </aside>

      <section className="msg-editor" aria-label="Message editor">
        <div className="msg-bar card">
          <div className="msg-bar-fields">
            <div className="field">
              <label className="field-label" htmlFor="msg-name">
                Template name
              </label>
              <input
                id="msg-name"
                className="input"
                placeholder={selectedId === null ? "Name it to save it" : "Template name"}
                maxLength={MESSAGE_LIMITS.templateName}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="field">
              <span className="field-label" id="msg-folder-label">
                Folder
              </span>
              <Combobox
                id="msg-folder"
                value={draft.folderId === null ? NO_FOLDER : String(draft.folderId)}
                searchable={false}
                aria-labelledby="msg-folder-label"
                options={folderOptions}
                onChange={(next) => setDraft({ ...draft, folderId: next === undefined || next === NO_FOLDER ? null : Number(next) })}
              />
            </div>
          </div>

          <div className="msg-bar-actions">
            {notice ? (
              <span className={notice.kind === "error" ? "msg-notice is-error" : "msg-notice"} role="status">
                {notice.text}
              </span>
            ) : dirty ? (
              <span className="msg-notice is-dirty">Unsaved changes</span>
            ) : null}
            {selectedId !== null ? (
              <>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !parsed.ok} onClick={() => void duplicate()}>
                  Duplicate
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void remove()}>
                  Delete
                </button>
              </>
            ) : null}
            <button type="button" className="btn btn-secondary btn-sm" disabled={!canSend} onClick={() => setSending(true)}>
              Send…
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!canSave} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="msg-workspace">
          <MessageForm
            guildId={guildId}
            value={draft}
            onChange={(next) => setDraft({ ...draft, ...next })}
            errors={errors}
            problems={shownErrors}
          />

          <div className="msg-side">
            <p className="cmd-section-title">Preview</p>
            <MessagePreview message={{ content: draft.content, embeds: draft.embeds, buttons: draft.buttons, selects: draft.selects, reactions: draft.reactions }} context={previewContext} />
          </div>
        </div>
      </section>

      {sending && parsed.ok ? (
        <SendDialog
          guildId={guildId}
          message={parsed.value}
          templateId={selectedId !== null && !dirty ? selectedId : null}
          context={previewContext}
          onClose={() => setSending(false)}
          onSent={() => {
            if (selectedId === null) return;
            const at = new Date().toISOString();
            setLibrary((current) => ({
              ...current,
              templates: current.templates.map((t) => (t.id === selectedId ? { ...t, lastSentAt: at } : t)),
            }));
          }}
        />
      ) : null}
    </div>
  );
}
