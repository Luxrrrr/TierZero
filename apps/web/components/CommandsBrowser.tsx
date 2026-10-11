"use client";

import { useMemo, useState } from "react";
import type { GuildCommandState } from "../lib/control-api";
import { CommandRow } from "./CommandRow";
import { CommandsIcon, SearchIcon } from "./Icons";

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

/**
 * Every command on a server, grouped by the feature that provides it. The
 * search narrows within the groups rather than flattening them, so a match
 * still says which feature it belongs to.
 */
export function CommandsBrowser({ guildId, groups }: Props) {
  const [query, setQuery] = useState("");

  const total = useMemo(
    () => groups.reduce((count, group) => count + group.commands.length, 0),
    [groups],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        commands: group.commands.filter(
          (command) =>
            command.name.toLowerCase().includes(needle) ||
            command.description.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.commands.length > 0);
  }, [groups, query]);

  const shown = filtered.reduce((count, group) => count + group.commands.length, 0);
  const searching = query.trim().length > 0;

  return (
    <>
      <div className="commands-toolbar">
        <div className="search">
          <SearchIcon />
          <input
            type="search"
            className="input"
            value={query}
            placeholder="Search commands"
            aria-label="Search commands"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="commands-count" role="status">
          {searching ? `${shown} of ${total} shown` : `${total} ${total === 1 ? "command" : "commands"}`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <CommandsIcon className="empty-icon" />
          <p className="empty-title">No command matches that</p>
          <p className="empty-text">
            Search matches a command&apos;s name and its description. Try a
            shorter word, or clear the search to see all {total}.
          </p>
          <div className="empty-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setQuery("")}>
              Clear search
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-groups">
          {filtered.map((group) => (
            <section className="card" key={group.id}>
              <div className="card-header">
                <div className="card-header-text">
                  <h2 className="card-title">{group.name}</h2>
                  <p className="card-help">{group.summary}</p>
                </div>
              </div>
              <ul className="command-list">
                {group.commands.map((command) => (
                  <CommandRow key={command.name} guildId={guildId} command={command} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
