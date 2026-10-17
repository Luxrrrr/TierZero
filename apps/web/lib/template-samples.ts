/**
 * The stand-ins a template preview fills its placeholders with. Kept free of
 * React so the tests can import it directly.
 */

/** The template with its placeholders filled in, an unknown one left as written. */
export function fillTemplate(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/**
 * Roughly what Discord makes of a text channel's name: lower case, spaces as
 * hyphens, and only letters, digits, hyphens and underscores kept. A module
 * may clean names further before it creates the channel.
 */
export function channelNamePreview(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/** Stand-ins for placeholders many modules share. */
const COMMON_SAMPLES: Record<string, string> = {
  user: "@FragMuffin",
  username: "FragMuffin",
  name: "FragMuffin",
  memberCount: "1,024",
  members: "1,024",
  level: "5",
  xp: "1,250",
  position: "1",
  rank: "1",
};

/**
 * What the preview fills each placeholder with: the schema's own samples
 * first, then the shared stand-ins, then the real server's name. A placeholder
 * with none of these shows as written, so it is visible that it gets filled in.
 */
export function sampleValues(
  placeholders: readonly string[],
  samples: Record<string, string> | undefined,
  serverName: string | undefined,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of placeholders) {
    const sample = samples?.[name] ?? COMMON_SAMPLES[name];
    if (sample !== undefined) values[name] = sample;
  }
  values.server = serverName ?? samples?.server ?? "Your server";
  return values;
}
