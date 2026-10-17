"use client";

import { useMemo, useState } from "react";
import type { ModuleCategory } from "@tier0/core";
import { ModuleTile } from "./ModuleTile";
import type { ModuleView } from "../lib/module-view";
import { orderModulesBySection, sectionCounts } from "../lib/sections";

interface Props {
  guildId: string;
  modules: ModuleView[];
  /** By module id, the permissions the bot lacks for it on this server. */
  missingPermissions?: Record<string, string[]>;
}

type Filter = "all" | ModuleCategory;

/**
 * Every feature as one grid of equal tiles, with a chip per category to narrow
 * it. The filter is deliberately not persisted: it is a way to find a tile, not
 * a preference.
 */
export function ModuleGrid({ guildId, modules, missingPermissions = {} }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  // The entrance plays once, on load. Tiles that appear because a chip was
  // pressed would otherwise all fade in again, which reads as a reload.
  const [filtered, setFiltered] = useState(false);

  const ordered = useMemo(() => orderModulesBySection(modules), [modules]);
  const chips = useMemo(() => sectionCounts(modules), [modules]);
  const visible = filter === "all" ? ordered : ordered.filter((module) => module.category === filter);

  function choose(next: Filter) {
    setFilter(next);
    setFiltered(true);
  }

  return (
    <>
      <div className="filter-chip-row" role="group" aria-label="Filter features by category">
        <button
          type="button"
          className="filter-chip"
          aria-pressed={filter === "all"}
          onClick={() => choose("all")}
        >
          All
          <span className="filter-chip-count">{modules.length}</span>
        </button>
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="filter-chip"
            aria-pressed={filter === chip.id}
            onClick={() => choose(chip.id)}
          >
            {chip.heading}
            <span className="filter-chip-count">{chip.count}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No features here</div>
          <p className="empty-text">Nothing matches this filter. Choose All to see every feature.</p>
        </div>
      ) : (
        <div className="module-grid">
          {visible.map((module, index) => (
            <ModuleTile
              key={module.id}
              guildId={guildId}
              module={module}
              index={index}
              animate={!filtered}
              missingPermissions={missingPermissions[module.id]}
            />
          ))}
        </div>
      )}
    </>
  );
}
