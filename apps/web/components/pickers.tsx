"use client";

import useSWR from "swr";
import { matchesChannelTypes } from "../lib/channel-types";

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

export function ChannelPicker({
  id,
  guildId,
  types = [],
  value,
  onChange,
}: PickerProps & { types?: string[] }) {
  const { data } = useSWR<Channel[]>(`/api/guilds/${guildId}/channels`, fetcher);
  const options = data?.filter((channel) => matchesChannelTypes(channel.type, types));

  return (
    <select
      id={id}
      value={value ?? ""}
      disabled={!data}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{data ? "Select a channel" : "Loading channels"}</option>
      {options?.map((channel) => (
        <option key={channel.id} value={channel.id}>
          #{channel.name}
        </option>
      ))}
    </select>
  );
}

export function RolePicker({ id, guildId, value, onChange }: PickerProps) {
  const { data } = useSWR<Role[]>(`/api/guilds/${guildId}/roles`, fetcher);

  return (
    <select
      id={id}
      value={value ?? ""}
      disabled={!data}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{data ? "Select a role" : "Loading roles"}</option>
      {data?.map((role) => (
        // A role above the bot's own cannot be assigned by it, so offering it
        // here would only produce a confusing failure later. The colour is
        // set inline because an <option> can't hold any other markup.
        <option
          key={role.id}
          value={role.id}
          disabled={!role.assignable}
          style={role.assignable ? { color: role.colour || undefined } : undefined}
        >
          {role.name}
          {role.assignable ? "" : " (above the bot's role)"}
        </option>
      ))}
    </select>
  );
}
