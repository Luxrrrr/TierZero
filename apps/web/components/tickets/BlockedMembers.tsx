"use client";

import { useEffect, useState } from "react";
import type { UserRef } from "@tier0/shared-moderation";
import { Avatar, displayName } from "../mod/ModUi";
import { blockedIds, withBlocked } from "../../lib/ticket-blocklist";
import { ticketsClient } from "../../lib/tickets-client";
import { MemberSearch } from "./MemberSearch";

/**
 * The members blocked from opening tickets, by name. The setting stores
 * Discord user IDs, which nobody should have to copy out of Discord, so this
 * finds members by name and shows who each stored ID is. It edits the same
 * draft as the form below it and is saved with it.
 */
export function BlockedMembers({
  guildId,
  settings,
  disabled,
  onChange,
}: {
  guildId: string;
  settings: Record<string, unknown>;
  disabled: boolean;
  onChange(next: Record<string, unknown>): void;
}) {
  const ids = blockedIds(settings);
  const [names, setNames] = useState<Record<string, UserRef>>({});
  const key = ids.join(",");

  useEffect(() => {
    const unknown = ids.filter((id) => !names[id]);
    if (unknown.length === 0) return;
    const controller = new AbortController();
    void ticketsClient.memberNames(guildId, unknown, controller.signal).then(
      (result) => {
        if (!result.ok) return;
        setNames((current) => ({ ...current, ...Object.fromEntries(result.value.map((hit) => [hit.user.userId, hit.user])) }));
      },
      () => undefined,
    );
    return () => controller.abort();
    // Only a change in which members are blocked needs new names.
  }, [guildId, key]);

  return (
    <section className="card tk-blocked" aria-labelledby="tk-blocked-title">
      <div className="card-header">
        <div className="card-header-text">
          <h2 className="card-title" id="tk-blocked-title">
            Blocked members
          </h2>
          <p className="card-help">
            Members here cannot open any ticket. Find them by name; the list is saved with the rest of the settings and is
            the same one shown as IDs under Blocklist.
          </p>
        </div>
      </div>
      <div className="card-body tk-blocked-body">
        <MemberSearch
          guildId={guildId}
          label="Find a member to block"
          exclude={ids}
          disabled={disabled}
          onPick={(user) => {
            setNames((current) => ({ ...current, [user.userId]: user }));
            onChange(withBlocked(settings, [...ids, user.userId]));
          }}
        />
        {ids.length === 0 ? (
          <p className="tk-muted tk-small">Nobody is blocked.</p>
        ) : (
          <ul className="tk-members tk-blocked-list">
            {ids.map((id) => {
              const user = names[id];
              const label = user ? displayName(user) : id;
              return (
                <li key={id}>
                  {user ? <Avatar user={user} size="sm" /> : null}
                  <span className="tk-member-name">{label}</span>
                  {user && !user.inServer ? <span className="tk-muted tk-small">Not in the server</span> : null}
                  <button
                    type="button"
                    className="tk-member-remove"
                    disabled={disabled}
                    onClick={() => onChange(withBlocked(settings, ids.filter((other) => other !== id)))}
                  >
                    Unblock<span className="visually-hidden"> {label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
