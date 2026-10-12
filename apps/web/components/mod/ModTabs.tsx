"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isTabCurrent, type ModTab } from "../../lib/mod-tabs";
import { HistoryIcon, KeyIcon, MessagesIcon, OverviewIcon, SetupIcon, UserIcon } from "../Icons";

const TAB_ICON: Record<ModTab["id"], (props: { className?: string }) => ReactNode> = {
  overview: OverviewIcon,
  members: UserIcon,
  logs: HistoryIcon,
  serverlogs: MessagesIcon,
  access: KeyIcon,
  settings: SetupIcon,
};

export function ModTabs({ tabs }: { tabs: ModTab[] }) {
  const pathname = usePathname() ?? "";

  return (
    <nav className="mod-tabs" aria-label="Moderation">
      {tabs.map((tab) => {
        const current = isTabCurrent(tab, pathname);
        const Icon = TAB_ICON[tab.id];
        return (
          <Link key={tab.id} href={tab.href} aria-current={current ? "page" : undefined}>
            <Icon />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
