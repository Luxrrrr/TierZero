"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import type { ReactNode } from "react";
import { initialsOf } from "../lib/discord-cdn";
import { SignOutIcon } from "./Icons";

interface Guild {
  id: string;
  name: string;
  icon: string | null;
}

interface Props {
  user: { name: string | null | undefined; image: string | null | undefined };
  signOutAction(): Promise<void>;
  children: ReactNode;
}

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : []));

/**
 * The frame around every signed-in page: the wordmark, a switcher to jump
 * between servers without going back to the list, and the signed-in
 * account. The switcher fetches the same /api/guilds route the server list
 * uses, so it degrades the same way (empty when the bot is offline) rather
 * than needing its own error handling.
 */
export function AppShell({ user, signOutAction, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: guilds } = useSWR<Guild[]>("/api/guilds", fetcher);

  const currentId = /^\/guilds\/([^/]+)/.exec(pathname ?? "")?.[1];

  return (
    <div className="shell">
      <header className="shell-header">
        <Link href="/guilds" className="shell-brand">
          <span className="mark">0</span>
          TierZero
        </Link>

        {guilds && guilds.length > 0 ? (
          <div className="shell-switcher">
            <label htmlFor="guild-switcher" className="visually-hidden">
              Switch server
            </label>
            <select
              id="guild-switcher"
              value={currentId ?? ""}
              onChange={(e) => {
                if (e.target.value) router.push(`/guilds/${e.target.value}`);
              }}
            >
              <option value="" disabled>
                Switch server…
              </option>
              {guilds.map((guild) => (
                <option key={guild.id} value={guild.id}>
                  {guild.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="shell-spacer" />
        )}

        <div className="shell-user">
          <span className="shell-user-avatar" aria-hidden="true">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" width={28} height={28} />
            ) : (
              initialsOf(user.name ?? "?")
            )}
          </span>
          <span className="shell-user-name">{user.name ?? "Signed in"}</span>
          <form action={signOutAction}>
            <button type="submit" className="btn btn-ghost btn-sm">
              <SignOutIcon />
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="shell-main">{children}</div>
    </div>
  );
}
