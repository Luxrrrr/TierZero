"use client";

import { useMemo, type CSSProperties } from "react";
import useSWR from "swr";
import { Combobox, MultiCombobox, type ComboboxOption } from "./Combobox";
import { fetchJson } from "./fetcher";

export interface GuildRole {
  id: string;
  name: string;
  color: string;
  /** False for a role positioned above the bot's own, which it cannot hand out. */
  assignable: boolean;
}

export interface RoleList {
  roles: GuildRole[];
  loading: boolean;
  failed: boolean;
  /** Asks the bot for the list again. */
  retry(): void;
}

/** One SWR key per guild, so every role picker on a page shares one fetch. */
export function useRoles(guildId: string, enabled = true): RoleList {
  const { data, error, isLoading, mutate } = useSWR<GuildRole[]>(
    enabled ? `/api/guilds/${guildId}/roles` : null,
    fetchJson,
  );
  return {
    roles: data ?? [],
    loading: isLoading,
    // A list loaded once and then failing to refresh is still good to show.
    failed: error !== undefined && data === undefined,
    retry: () => void mutate(),
  };
}

const LIST_FAILED = "The role list could not be loaded, so saved roles are shown by their ID.";

/** Where the bot hands the role out: roles above its own cannot be given, so they are greyed out. */
const ABOVE_THE_BOT_ASSIGNS =
  "Roles above the bot's highest role are greyed out: the bot cannot give those to anyone. Move the bot's role higher in Server Settings to use them.";

/** Where the role only matches members: its position does not matter. */
const ABOVE_THE_BOT_MATCHES =
  "Roles above the bot's highest role can be picked here too, since the bot only checks for this role and never gives it out.";

function unloaded(id: string): string {
  return `Saved role, ID ${id}`;
}

interface SingleProps {
  id: string;
  guildId: string;
  value: string | undefined;
  onChange(next: string | undefined): void;
  clearable?: boolean;
  /**
   * The bot gives this role to members, as the schema's `assigns` says, so a
   * role above the bot's own is greyed out. Without it every role can be picked.
   */
  assigns?: boolean;
  disabled?: boolean;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export function RolePicker({
  id,
  guildId,
  value,
  onChange,
  clearable = false,
  assigns = false,
  disabled = false,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: SingleProps) {
  const { roles, loading, failed, retry } = useRoles(guildId);
  const options = useMemo(() => roleOptions(roles, assigns), [roles, assigns]);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      failed={failed}
      failedText={LIST_FAILED}
      onRetry={retry}
      unloadedLabel={unloaded}
      disabled={disabled}
      clearable={clearable}
      clearLabel="No role"
      placeholder="Choose a role"
      missingLabel="Unknown role (deleted)"
      searchLabel="Search roles"
      searchPlaceholder="Search roles"
      emptyText="No role here matches that."
      footer={roleFooter(roles, assigns)}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    />
  );
}

interface MultiProps {
  id: string;
  guildId: string;
  values: string[];
  onChange(next: string[]): void;
  max?: number;
  /** As on `RolePicker`. */
  assigns?: boolean;
  disabled?: boolean;
  addLabel?: string;
  emptyLabel?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export function MultiRolePicker({
  id,
  guildId,
  values,
  onChange,
  max,
  assigns = false,
  disabled = false,
  addLabel = "Add a role",
  emptyLabel,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: MultiProps) {
  const { roles, loading, failed, retry } = useRoles(guildId);
  const options = useMemo(() => roleOptions(roles, assigns), [roles, assigns]);

  return (
    <MultiCombobox
      id={id}
      values={values}
      onChange={onChange}
      options={options}
      max={max}
      loading={loading}
      failed={failed}
      failedText={LIST_FAILED}
      onRetry={retry}
      unloadedLabel={unloaded}
      disabled={disabled}
      addLabel={addLabel}
      emptyLabel={emptyLabel}
      missingLabel="Unknown role (deleted)"
      searchLabel="Search roles"
      searchPlaceholder="Search roles"
      emptyText="No role here matches that."
      footer={roleFooter(roles, assigns)}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    />
  );
}

function roleFooter(roles: readonly GuildRole[], assigns: boolean): string | undefined {
  if (!roles.some((role) => !role.assignable)) return undefined;
  return assigns ? ABOVE_THE_BOT_ASSIGNS : ABOVE_THE_BOT_MATCHES;
}

/**
 * The picker's rows. Only a role the bot would have to hand out is greyed out
 * for sitting above the bot; a role used to exempt, limit or ping members is
 * checked, never given, so its position does not matter.
 */
export function roleOptions(roles: readonly GuildRole[], assigns = false): ComboboxOption[] {
  return roles.map((role) => {
    const option: ComboboxOption = {
      value: role.id,
      label: role.name,
      icon: <RoleDot color={role.color} />,
    };
    if (assigns && !role.assignable) {
      option.disabled = true;
      option.note = "Above the bot's role";
    }
    return option;
  });
}

/** Discord reports an uncolored role as #000000, which is not a color anyone chose. */
function RoleDot({ color }: { color: string }) {
  const style =
    color && color !== "#000000" ? ({ "--role-color": color } as CSSProperties) : undefined;
  return <span className="role-dot" style={style} aria-hidden="true" />;
}
