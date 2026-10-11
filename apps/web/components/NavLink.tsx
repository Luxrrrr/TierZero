"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface Props {
  href: string;
  /** Match the path exactly, for a link whose route is a prefix of others. */
  exact?: boolean;
  /** What the collapsed rail shows on hover and keyboard focus. Defaults to nothing. */
  tip?: string;
  children: ReactNode;
}

/**
 * The sidebar is rendered on the server, but which entry is current is a
 * property of the URL in the browser, so only this leaf reads the pathname.
 */
export function NavLink({ href, exact, tip, children }: Props) {
  const pathname = usePathname() ?? "";
  const current = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={current ? "nav-link is-current" : "nav-link"}
      aria-current={current ? "page" : undefined}
      data-rail-tip={tip}
    >
      {children}
    </Link>
  );
}
