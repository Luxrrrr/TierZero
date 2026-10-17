"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  SECTION_HASH_PREFIX,
  sectionErrorCounts,
  sectionForErrors,
  sectionFromHash,
  type SettingsSection,
} from "../../lib/settings-sections";

/** An entry the page adds after the schema's own sections. */
export interface ExtraSection {
  id: string;
  label: string;
  content: ReactNode;
}

interface Props {
  sections: SettingsSection[];
  errors: Record<string, string>;
  intro?: Record<string, ReactNode>;
  extra: ExtraSection[];
  render(section: SettingsSection): ReactNode;
}

/**
 * A settings page split into the parts its schema names, with a list of them
 * beside the form. Every part stays mounted and the others are hidden, so a
 * row someone opened is still open when they come back to it. The address
 * carries the part shown, so a link can point at one.
 */
export function SectionedSettings({ sections, errors, intro, extra, render }: Props) {
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const extraIds = extra.map((entry) => entry.id);
  const extraKey = extraIds.join("|");
  const [current, setCurrent] = useState(sections[0]?.id ?? "");

  // Adjusted during render rather than in an effect, so the part holding the
  // first failing field is already on screen when the page goes looking for it.
  const errorKey = Object.keys(errors).join("|");
  const [seenErrors, setSeenErrors] = useState(errorKey);
  if (errorKey !== seenErrors) {
    setSeenErrors(errorKey);
    if (errorKey !== "") setCurrent(sectionForErrors(sections, errors, current));
  }

  // The schema is described afresh on every render, so the effect is keyed on
  // what the sections are rather than on the array.
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const sectionKey = sections.map((section) => `${section.id}:${section.keys.join(",")}`).join("|");
  useEffect(() => {
    const ids = extraKey === "" ? [] : extraKey.split("|");
    function follow() {
      const target = sectionFromHash(window.location.hash, sectionsRef.current, ids);
      if (target !== undefined) setCurrent(target);
    }
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [sectionKey, extraKey]);

  const counts = sectionErrorCounts(sections, errors);
  const entries = [
    ...sections.map((section) => ({ id: section.id, label: section.label })),
    ...extra.map((entry) => ({ id: entry.id, label: entry.label })),
  ];

  function choose(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    setCurrent(id);
    window.history.replaceState(null, "", `${SECTION_HASH_PREFIX}${encodeURIComponent(id)}`);
    const root = rootRef.current;
    if (root && root.getBoundingClientRect().top < 0) {
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      root.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });
    }
  }

  const panelId = (id: string) => `${baseId}-panel-${id}`;

  return (
    <div className="settings-sectioned" ref={rootRef}>
      <div className="settings-sectioned-grid">
        <nav className="settings-nav" aria-label="Parts of these settings">
          <ul>
            {entries.map((entry) => {
              const failing = counts[entry.id] ?? 0;
              return (
                <li key={entry.id}>
                  <a
                    href={`${SECTION_HASH_PREFIX}${encodeURIComponent(entry.id)}`}
                    aria-current={entry.id === current ? "true" : undefined}
                    aria-controls={panelId(entry.id)}
                    onClick={(event) => choose(event, entry.id)}
                  >
                    <span className="settings-nav-label">{entry.label}</span>
                    {failing > 0 ? (
                      <span className="settings-nav-errors">
                        <span aria-hidden="true">{failing}</span>
                        <span className="visually-hidden">
                          , {failing} {failing === 1 ? "field needs" : "fields need"} fixing
                        </span>
                      </span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="settings-sections">
          {sections.map((section) => (
            <div
              key={section.id}
              id={panelId(section.id)}
              className="settings-section"
              role="region"
              aria-label={section.label}
              hidden={section.id !== current}
            >
              {intro?.[section.id] ?? null}
              {render(section)}
            </div>
          ))}
          {extra.map((entry) => (
            <div
              key={entry.id}
              id={panelId(entry.id)}
              className="settings-section"
              role="region"
              aria-label={entry.label}
              hidden={entry.id !== current}
            >
              {entry.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
