/**
 * What the Commands page and the overview say about a command, worked out the
 * way the bot registers them: only the commands of features that are on, and
 * of those only the ones not switched off. Free of React so the tests can
 * import it directly.
 */

export interface CommandLike {
  enabled: boolean;
  allowRoles: string[];
  denyChannels: string[];
  allowChannels?: string[];
}

export interface ModuleLike {
  enabled: boolean;
  alwaysOn: boolean;
  commands: CommandLike[];
}

/** A built-in part of the bot is on with no switch, so its commands count as a feature that is on. */
export function featureIsOn(module: Pick<ModuleLike, "enabled" | "alwaysOn">): boolean {
  return module.alwaysOn || module.enabled;
}

export interface CommandCounts {
  /** Every command the installed features offer. */
  total: number;
  /** What the bot puts in Discord for this server. */
  live: number;
  /** Switched off on the Commands page. */
  hidden: number;
  /** Belonging to a feature that is off, so not in Discord whatever their own switch says. */
  featureOff: number;
  /** With a role or channel rule. */
  restricted: number;
}

export function commandCounts(modules: readonly ModuleLike[]): CommandCounts {
  const counts: CommandCounts = { total: 0, live: 0, hidden: 0, featureOff: 0, restricted: 0 };
  for (const module of modules) {
    const on = featureIsOn(module);
    for (const command of module.commands) {
      counts.total += 1;
      if (!on) counts.featureOff += 1;
      else if (!command.enabled) counts.hidden += 1;
      else counts.live += 1;
      if (command.allowRoles.length > 0 || command.denyChannels.length > 0 || (command.allowChannels?.length ?? 0) > 0) {
        counts.restricted += 1;
      }
    }
  }
  return counts;
}

export type CommandStatus = "featureOff" | "off" | "customized" | "default";

/** The pill on a row. A feature that is off wins, since nothing about the command itself matters then. */
export function commandStatus(featureOn: boolean, enabled: boolean, changed: number): CommandStatus {
  if (!featureOn) return "featureOff";
  if (!enabled) return "off";
  return changed > 0 ? "customized" : "default";
}

export const STATUS_LABEL: Record<CommandStatus, string> = {
  featureOff: "Feature off",
  off: "Off",
  customized: "Customized",
  default: "Default",
};

/** Where a command works, as one of three answers, however the two lists are stored. */
export type ChannelMode = "everywhere" | "only" | "except";

export function channelModeOf(value: { denyChannels: string[]; allowChannels?: string[] }): ChannelMode {
  if ((value.allowChannels?.length ?? 0) > 0) return "only";
  return value.denyChannels.length > 0 ? "except" : "everywhere";
}

export function channelSummary(value: { denyChannels: string[]; allowChannels?: string[] }): string {
  const allow = value.allowChannels?.length ?? 0;
  const deny = value.denyChannels.length;
  const channels = (count: number) => `${count} ${count === 1 ? "channel" : "channels"}`;
  if (allow > 0) return deny > 0 ? `Only in ${channels(allow)}, not ${deny}` : `Only in ${channels(allow)}`;
  return deny > 0 ? `Off in ${channels(deny)}` : "Everywhere";
}

/**
 * What the overview's count of commands in Discord should say. The bot's own
 * record of its last registration is the truth, unless a change is still
 * waiting to go out or the bot has not registered since it started; then the
 * count the settings imply is the better guess.
 */
export function liveCountShown(computed: number, sync: { registered: number | null; pending: boolean } | null): number {
  if (!sync || sync.pending || sync.registered === null) return computed;
  return sync.registered;
}
