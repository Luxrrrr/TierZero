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
}

/** One SWR key per guild, so every role picker on a page shares one fetch. */
export function useRoles(guildId: string, enabled = true): RoleList {
  const { data, error, isLoading } = useSWR<GuildRole[]>(
    enabled ? `/api/guilds/${guildId}/roles` : null,
    fetchJson,
  );
  return { roles: data ?? [], loading: isLoading, failed: error !== undefined };
}

const LIST_FAILED = "The role list could not be loaded. Reload the page to try again.";

const ABOVE_THE_BOT = "Roles above the bot's highest role cannot be assigned by it.";

interface SingleProps {
  id: string;
  guildId: string;
  value: string | undefined;
  onChange(next: string | undefined): void;
  clearable?: boolean;
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
  disabled = false,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: SingleProps) {
  const { roles, loading, failed } = useRoles(guildId);
  const options = useMemo(() => roleOptions(roles), [roles]);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      disabled={disabled}
      clearable={clearable}
      clearLabel="No role"
      placeholder="Choose a role"
      missingLabel="Unknown role (deleted)"
      searchLabel="Search roles"
      searchPlaceholder="Search roles"
      emptyText={failed ? LIST_FAILED : "No role here matches that."}
      footer={roles.some((role) => !role.assignable) ? ABOVE_THE_BOT : undefined}
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
  disabled = false,
  addLabel = "Add a role",
  emptyLabel,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: MultiProps) {
  const { roles, loading, failed } = useRoles(guildId);
  const options = useMemo(() => roleOptions(roles), [roles]);

  return (
    <MultiCombobox
      id={id}
      values={values}
      onChange={onChange}
      options={options}
      max={max}
      loading={loading}
      disabled={disabled}
      addLabel={addLabel}
      emptyLabel={emptyLabel}
      missingLabel="Unknown role (deleted)"
      searchLabel="Search roles"
      searchPlaceholder="Search roles"
      emptyText={failed ? LIST_FAILED : "No role here matches that."}
      footer={roles.some((role) => !role.assignable) ? ABOVE_THE_BOT : undefined}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    />
  );
}

export function roleOptions(roles: readonly GuildRole[]): ComboboxOption[] {
  return roles.map((role) => {
    const option: ComboboxOption = {
      value: role.id,
      label: role.name,
      icon: <RoleDot color={role.color} />,
    };
    if (!role.assignable) {
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
