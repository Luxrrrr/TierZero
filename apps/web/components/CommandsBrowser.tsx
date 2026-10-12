"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuildCommandState } from "../lib/control-api";
import { shortLabel } from "../lib/command-permissions";
import { CommandSheet, changedCount, type CommandValues, type SaveState } from "./CommandSheet";
import { Switch } from "./form";
import { ChevronRightIcon, CommandsIcon, EyeIcon, SearchIcon, ShieldIcon } from "./Icons";

export interface CommandGroup {
  id: string;
  name: string;
  summary: string;
  commands: GuildCommandState[];
}

interface Props {
  guildId: string;
  groups: CommandGroup[];
}

type Filter = "all" | "customized" | "off";

const SAVED_LINGER_MS = 2000;
const ALL = "all";

function valuesOf(command: GuildCommandState): CommandValues {
  return {
    enabled: command.enabled,
    allowRoles: command.allowRoles,
    denyChannels: command.denyChannels,
    permissions: command.permissions,
    ephemeral: command.ephemeral,
    customReply: command.customReply,
  };
}

/**
 * Every command on a server, one feature per tab, as a table. A command opens
 * in a sheet over the list.
 *
 * The values for every command live here rather than in the sheet. The table
 * shows which commands are customized or off, and the sheet is swapped as
 * commands are opened, so a sheet that owned its own state would forget an edit
 * the moment another command was picked.
 */
export function CommandsBrowser({ guildId, groups }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tab, setTab] = useState<string>(ALL);
  const [values, setValues] = useState<Record<string, CommandValues>>(() =>
    Object.fromEntries(groups.flatMap((g) => g.commands).map((c) => [c.name, valuesOf(c)])),
  );
  const [openName, setOpenName] = useState<string | null>(null);
  const [save, setSave] = useState<{ name: string; state: SaveState }>({ name: "", state: "idle" });
  const searchRef = useRef<HTMLInputElement>(null);
  // Where focus goes back to when the sheet closes, so keyboard use is not left at the top of the page.
  const returnFocus = useRef<HTMLElement | null>(null);

  const all = useMemo(() => groups.flatMap((group) => group.commands), [groups]);
  const byName = useMemo(() => new Map(all.map((command) => [command.name, command])), [all]);

  const counts = useMemo(() => {
    let customized = 0;
    let off = 0;
    for (const command of all) {
      const value = values[command.name];
      if (!value) continue;
      if (changedCount(value) > 0) customized += 1;
      if (!value.enabled) off += 1;
    }
    return { all: all.length, customized, off };
  }, [all, values]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups
      .filter((group) => tab === ALL || group.id === tab)
      .map((group) => ({
        ...group,
        commands: group.commands.filter((command) => {
          const value = values[command.name];
          if (!value) return false;
          if (filter === "customized" && changedCount(value) === 0) return false;
          if (filter === "off" && value.enabled) return false;
          if (!needle) return true;
          return (
            command.name.toLowerCase().includes(needle) ||
            command.description.toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((group) => group.commands.length > 0);
  }, [groups, tab, query, filter, values]);

  const shown = filtered.reduce((count, group) => count + group.commands.length, 0);

  useEffect(() => {
    if (save.state !== "saved") return;
    const timer = window.setTimeout(() => setSave((s) => ({ ...s, state: "idle" })), SAVED_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [save]);

  // "/" jumps to the search, the way it does in most apps with a list this long.
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

  const patch = useCallback(
    async (name: string, change: Partial<CommandValues>) => {
      const before = values[name];
      if (!before) return;
      setValues((current) => ({ ...current, [name]: { ...before, ...change } }));
      setSave({ name, state: "saving" });
      try {
        const res = await fetch(`/api/guilds/${guildId}/commands/${encodeURIComponent(name)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(change),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSave({ name, state: "saved" });
      } catch {
        // Only the keys this change touched go back, so an edit made meanwhile survives.
        setValues((current) => {
          const now = current[name];
          if (!now) return current;
          const restored = { ...now };
          for (const key of Object.keys(change) as (keyof CommandValues)[]) {
            (restored as Record<string, unknown>)[key] = before[key];
          }
          return { ...current, [name]: restored };
        });
        setSave({ name, state: "error" });
      }
    },
    [guildId, values],
  );

  function openCommand(name: string, trigger: HTMLElement) {
    returnFocus.current = trigger;
    setOpenName(name);
  }

  function closeSheet() {
    setOpenName(null);
    returnFocus.current?.focus();
  }

  const opened = openName ? byName.get(openName) : undefined;
  const openedValue = openName ? values[openName] : undefined;

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "Everything", count: counts.all },
    { id: "customized", label: "Customized", count: counts.customized },
    { id: "off", label: "Off", count: counts.off },
  ];

  return (
    <>
      <div className="cmd-tabs" role="tablist" aria-label="Feature">
        {[{ id: ALL, name: "All", count: all.length }, ...groups.map((g) => ({ id: g.id, name: g.name, count: g.commands.length }))].map(
          (item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="cmd-tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.name}
              <span className="cmd-tab-count">{item.count}</span>
            </button>
          ),
        )}
      </div>

      <div className="cmd-toolbar">
        <div className="cmd-chips" role="group" aria-label="Show">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="cmd-chip"
              aria-pressed={filter === chip.id}
              onClick={() => setFilter(chip.id)}
            >
              {chip.label}
              <span className="cmd-chip-count">{chip.count}</span>
            </button>
          ))}
        </div>
        <div className="search">
          <SearchIcon />
          <input
            ref={searchRef}
            type="search"
            className="input"
            value={query}
            placeholder="Search commands"
            aria-label="Search commands"
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="cmd-kbd" aria-hidden="true">
            /
          </kbd>
        </div>
      </div>

      {shown === 0 ? (
        <div className="empty">
          <CommandsIcon className="empty-icon" />
          <p className="empty-title">No command matches that</p>
          <p className="empty-text">
            Search matches a command&apos;s name and its description. Try a shorter word, or clear
            the search and the filter to see everything.
          </p>
          <div className="empty-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setQuery("");
                setFilter("all");
                setTab(ALL);
              }}
            >
              Show everything
            </button>
          </div>
        </div>
      ) : (
        <div className="cmd-table card">
          <div className="cmd-cols" aria-hidden="true">
            <span>Command</span>
            <span>Who can use it</span>
            <span>Reply</span>
            <span>Status</span>
            <span>On</span>
            <span />
          </div>
          {filtered.map((group) => (
            <section key={group.id} aria-label={group.name}>
              {tab === ALL ? (
                <div className="cmd-group-label">
                  <span>{group.name}</span>
                  <span>{group.commands.length}</span>
                </div>
              ) : null}
              <ul>
                {group.commands.map((command) => {
                  const value = values[command.name];
                  if (!value) return null;
                  const label = command.kind === "slash" ? `/${command.name}` : command.name;
                  const customized = changedCount(value) > 0;
                  const replyPrivate = value.ephemeral ?? command.privateByDefault;
                  const sees =
                    value.allowRoles.length > 0
                      ? `${value.allowRoles.length} ${value.allowRoles.length === 1 ? "role" : "roles"}`
                      : value.permissions === null
                      ? command.defaultPermissions === null
                        ? "Everyone"
                        : shortLabel(command.defaultPermissions)
                      : value.permissions === "everyone"
                        ? "Everyone"
                        : shortLabel(value.permissions);
                  return (
                    <li
                      key={command.name}
                      className="cmd-row"
                      data-off={value.enabled ? undefined : "true"}
                      data-open={command.name === openName ? "true" : undefined}
                    >
                      <div className="cmd-cell-main">
                        <span
                          className="cmd-tile"
                          data-kind={command.kind === "slash" ? "slash" : "menu"}
                          aria-hidden="true"
                        >
                          {command.kind === "slash" ? "/" : "↗"}
                        </span>
                        <div className="cmd-main-text">
                          <button
                            type="button"
                            className="cmd-open"
                            aria-label={`Settings for ${label}`}
                            onClick={(event) => openCommand(command.name, event.currentTarget)}
                          >
                            <code>{label}</code>
                          </button>
                          <span className="cmd-desc">
                            {command.kind === "slash"
                              ? command.description
                              : command.kind === "user"
                                ? `Right-click a member. ${command.description}`
                                : `Right-click a message. ${command.description}`}
                          </span>
                        </div>
                      </div>
                      <span className="cmd-cell" data-changed={value.permissions !== null || value.allowRoles.length > 0 ? "true" : undefined}>
                        <ShieldIcon />
                        {sees}
                      </span>
                      <span
                        className="cmd-cell"
                        data-changed={value.ephemeral !== null || value.customReply !== null ? "true" : undefined}
                      >
                        <EyeIcon />
                        {command.repliesVary ? "Varies" : replyPrivate ? "Private" : "Public"}
                      </span>
                      <span>
                        <span
                          className={
                            !value.enabled ? "cmd-pill is-off" : customized ? "cmd-pill is-changed" : "cmd-pill"
                          }
                        >
                          <i aria-hidden="true" />
                          {!value.enabled ? "Off" : customized ? "Customized" : "Default"}
                        </span>
                      </span>
                      <span className="cmd-switch">
                        <Switch
                          checked={value.enabled}
                          onChange={(next) => void patch(command.name, { enabled: next })}
                          aria-label={`${label} is on`}
                        />
                      </span>
                      <ChevronRightIcon className="cmd-chevron" />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {opened && openedValue ? (
        <CommandSheet
          guildId={guildId}
          command={opened}
          value={openedValue}
          status={save.name === opened.name ? save.state : "idle"}
          onPatch={(change) => void patch(opened.name, change)}
          onClose={closeSheet}
        />
      ) : null}
    </>
  );
}
