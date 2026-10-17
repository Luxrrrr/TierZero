"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isTabCurrent, type ModTab } from "../../lib/mod-tabs";
import { useScrollCues } from "./ScrollCues";
import { AlertIcon, HistoryIcon, InboxIcon, KeyIcon, LockIcon, MessagesIcon, OverviewIcon, SetupIcon, UserIcon } from "../Icons";

const TAB_ICON: Record<ModTab["id"], (props: { className?: string }) => ReactNode> = {
  overview: OverviewIcon,
  members: UserIcon,
  logs: HistoryIcon,
  serverlogs: MessagesIcon,
  appeals: InboxIcon,
  raid: LockIcon,
  access: KeyIcon,
  settings: SetupIcon,
  danger: AlertIcon,
};

export function ModTabs({ tabs }: { tabs: ModTab[] }) {
  const pathname = usePathname() ?? "";
  useScrollCues(pathname);

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
