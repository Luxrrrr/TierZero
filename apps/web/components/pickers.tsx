"use client";

import useSWR from "swr";

interface PickerProps {
  id: string;
  guildId: string;
  value: string | undefined;
  onChange(next: string | undefined): void;
}

interface Channel {
  id: string;
  name: string;
  type: number;
}

interface Role {
  id: string;
  name: string;
  colour: string;
  assignable: boolean;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ChannelPicker({ id, guildId, value, onChange }: PickerProps & { types?: string[] }) {
  const { data, isLoading } = useSWR<Channel[]>(`/api/guilds/${guildId}/channels`, fetcher);

  return (
    <select
      id={id}
      value={value ?? ""}
      disabled={isLoading}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{isLoading ? "Loading channels" : "Select a channel"}</option>
      {data?.map((channel) => (
        <option key={channel.id} value={channel.id}>
          #{channel.name}
        </option>
      ))}
    </select>
  );
}

export function RolePicker({ id, guildId, value, onChange }: PickerProps) {
  const { data, isLoading } = useSWR<Role[]>(`/api/guilds/${guildId}/roles`, fetcher);

  return (
    <select
      id={id}
      value={value ?? ""}
      disabled={isLoading}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{isLoading ? "Loading roles" : "Select a role"}</option>
      {data?.map((role) => (
        // A role above the bot's own cannot be assigned by it, so offering it
        // here would only produce a confusing failure later.
        <option key={role.id} value={role.id} disabled={!role.assignable}>
          {role.name}
          {role.assignable ? "" : " (above the bot's role)"}
        </option>
      ))}
    </select>
  );
}
