"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { CHANNEL_TYPES, matchesChannelTypes } from "../../lib/channel-types";
import { FolderIcon, HashIcon, MegaphoneIcon, MessagesIcon, SpeakerIcon } from "../Icons";
import { Combobox, MultiCombobox, type ComboboxOption } from "./Combobox";
import { fetchJson } from "./fetcher";

export interface GuildChannel {
  id: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
}

export interface ChannelList {
  channels: GuildChannel[];
  loading: boolean;
  failed: boolean;
}

/**
 * One SWR key per guild, so a page full of channel pickers fetches the list
 * once and every picker shares it.
 */
export function useChannels(guildId: string, enabled = true): ChannelList {
  const { data, error, isLoading } = useSWR<GuildChannel[]>(
    enabled ? `/api/guilds/${guildId}/channels` : null,
    fetchJson,
  );
  return { channels: data ?? [], loading: isLoading, failed: error !== undefined };
}

const DEFAULT_TYPES = ["text"];

const LIST_FAILED = "The channel list could not be loaded. Reload the page to try again.";

interface SingleProps {
  id: string;
  guildId: string;
  types?: readonly string[];
  value: string | undefined;
  onChange(next: string | undefined): void;
  clearable?: boolean;
  disabled?: boolean;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export function ChannelPicker({
  id,
  guildId,
  types = DEFAULT_TYPES,
  value,
  onChange,
  clearable = false,
  disabled = false,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: SingleProps) {
  const { channels, loading, failed } = useChannels(guildId);
  const options = useMemo(() => channelOptions(channels, types), [channels, types]);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      disabled={disabled}
      clearable={clearable}
      clearLabel="No channel"
      placeholder="Choose a channel"
      missingLabel="Unknown channel (deleted)"
      searchLabel="Search channels"
      searchPlaceholder="Search channels"
      emptyText={failed ? LIST_FAILED : "No channel here matches that."}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    />
  );
}

interface MultiProps {
  id: string;
  guildId: string;
  types?: readonly string[];
  values: string[];
  onChange(next: string[]): void;
  max?: number;
  disabled?: boolean;
  addLabel?: string;
  emptyLabel?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export function MultiChannelPicker({
  id,
  guildId,
  types = DEFAULT_TYPES,
  values,
  onChange,
  max,
  disabled = false,
  addLabel = "Add a channel",
  emptyLabel,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: MultiProps) {
  const { channels, loading, failed } = useChannels(guildId);
  const options = useMemo(() => channelOptions(channels, types), [channels, types]);

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
      missingLabel="Unknown channel (deleted)"
      searchLabel="Search channels"
      searchPlaceholder="Search channels"
      emptyText={failed ? LIST_FAILED : "No channel here matches that."}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    />
  );
}

/**
 * Channels in the order Discord shows them: the ones outside any category
 * first, then a heading per category and its children beneath it.
 */
export function channelOptions(
  channels: readonly GuildChannel[],
  types: readonly string[],
): ComboboxOption[] {
  const categories = new Map<string, GuildChannel>();
  for (const channel of channels) {
    if (channel.type === CHANNEL_TYPES.category) categories.set(channel.id, channel);
  }

  const wanted = channels.filter((channel) => matchesChannelTypes(channel.type, types));
  const sorted = [...wanted].sort((a, b) => {
    const categoryA = a.parentId ? categories.get(a.parentId) : undefined;
    const categoryB = b.parentId ? categories.get(b.parentId) : undefined;
    // A channel with no category sits above every category, as it does in Discord.
    const rankA = categoryA?.position ?? -1;
    const rankB = categoryB?.position ?? -1;
    if (rankA !== rankB) return rankA - rankB;
    if (a.position !== b.position) return a.position - b.position;
    return a.name.localeCompare(b.name);
  });

  return sorted.map((channel) => {
    const category = channel.parentId ? categories.get(channel.parentId) : undefined;
    const option: ComboboxOption = {
      value: channel.id,
      label: channel.name,
      icon: <ChannelIcon type={channel.type} />,
    };
    if (category) option.group = category.name;
    return option;
  });
}

function ChannelIcon({ type }: { type: number }) {
  return (
    <span className="channel-icon" aria-hidden="true">
      {glyphFor(type)}
    </span>
  );
}

function glyphFor(type: number) {
  switch (type) {
    case CHANNEL_TYPES.announcement:
      return <MegaphoneIcon />;
    case CHANNEL_TYPES.voice:
      return <SpeakerIcon />;
    case CHANNEL_TYPES.forum:
      return <MessagesIcon />;
    case CHANNEL_TYPES.category:
      return <FolderIcon />;
    default:
      return <HashIcon />;
  }
}
