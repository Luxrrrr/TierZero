import Link from "next/link";
import type { ModuleCategory } from "@tier0/core";
import type { SectionGroup } from "../lib/sections";

interface Props {
  guildId: string;
  sections: SectionGroup[];
  current: ModuleCategory;
}

/**
 * The persistent switcher between a guild's dashboard sections. Only
 * sections with at least one module are listed, so an install missing a
 * module package never shows a dead link. Renders nothing when no section
 * has anything to show, which only happens on an install with no modules
 * registered at all.
 */
export function SectionNav({ guildId, sections, current }: Props) {
  const visible = sections.filter((section) => section.modules.length > 0);
  if (visible.length === 0) return null;

  return (
    <nav className="section-nav" aria-label="Dashboard sections">
      <ul>
        {visible.map((section) => {
          const isCurrent = section.id === current;
          return (
            <li key={section.id}>
              <Link
                href={`/guilds/${guildId}/${section.id}`}
                aria-current={isCurrent ? "page" : undefined}
                className={isCurrent ? "is-current" : undefined}
              >
                {section.heading}
                {section.hasEnabled ? (
                  <>
                    <span className="section-nav-dot" aria-hidden="true" />
                    <span className="visually-hidden">, configured</span>
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
