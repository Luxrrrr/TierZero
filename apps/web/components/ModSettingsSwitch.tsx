"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ModuleStatus } from "../lib/module-status";
import { statusWord } from "../lib/module-view";

export interface SettingsSwitchItem {
  id: string;
  name: string;
  href: string;
  status: ModuleStatus;
}

/**
 * Moves between the modules a dashboard area hosts. These are links to
 * separate routes rather than tabs in one page, so each has its own address
 * and the browser's back button does what it should.
 */
export function ModSettingsSwitch({ items }: { items: SettingsSwitchItem[] }) {
  const pathname = usePathname() ?? "";

  return (
    <nav className="settings-switch" suppressHydrationWarning aria-label="Moderation settings">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          aria-current={pathname === item.href ? "page" : undefined}
        >
          <span className="dot" data-status={item.status} aria-hidden="true" />
          {item.name}
          <span className="visually-hidden">, {statusWord(item.status).toLowerCase()}</span>
        </Link>
      ))}
    </nav>
  );
}
