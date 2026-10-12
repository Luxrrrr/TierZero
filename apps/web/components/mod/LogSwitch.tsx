import Link from "next/link";

/**
 * Switches between the two logs that share the Logs tab: what was done to
 * members, and what staff changed in the dashboard. Staff who cannot read the
 * second one see no switch, since there is nothing to switch to.
 */
export function LogSwitch({ guildId, current, canSeeStaffActivity }: { guildId: string; current: "actions" | "audit"; canSeeStaffActivity: boolean }) {
  if (!canSeeStaffActivity) return null;
  const base = `/guilds/${guildId}/mod`;
  const items = [
    { id: "actions", label: "Member actions", hint: "Warns, timeouts, kicks and bans", href: `${base}/actions` },
    { id: "audit", label: "Staff activity", hint: "What staff changed in the dashboard", href: `${base}/audit` },
  ] as const;
  return (
    <nav className="log-switch" aria-label="Logs">
      {items.map((item) => (
        <Link key={item.id} href={item.href} title={item.hint} aria-current={current === item.id ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
