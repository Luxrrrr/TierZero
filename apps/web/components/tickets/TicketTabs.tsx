"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isTicketTabCurrent, type TicketTab } from "../../lib/ticket-tabs";
import { ArchiveIcon, ChartIcon, InboxIcon, SetupIcon } from "../Icons";

const TAB_ICON: Record<TicketTab["id"], (props: { className?: string }) => ReactNode> = {
  inbox: InboxIcon,
  transcripts: ArchiveIcon,
  stats: ChartIcon,
  settings: SetupIcon,
};

export function TicketTabs({ tabs, flags = {} }: { tabs: TicketTab[]; flags?: Partial<Record<TicketTab["id"], string>> }) {
  const pathname = usePathname() ?? "";

  return (
    <nav className="mod-tabs" aria-label="Tickets">
      {tabs.map((tab) => {
        const Icon = TAB_ICON[tab.id];
        const flag = flags[tab.id];
        return (
          <Link key={tab.id} href={tab.href} aria-current={isTicketTabCurrent(tab, pathname) ? "page" : undefined}>
            <Icon />
            {tab.label}
            {flag ? (
              <>
                <span className="dot tk-tab-flag" data-status="attention" aria-hidden="true" />
                <span className="visually-hidden">, {flag}</span>
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
