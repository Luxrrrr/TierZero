/**
 * Substitution for welcome and farewell templates. Kept free of discord.js so
 * it can be unit tested without a client or a guild.
 */

export const PLACEHOLDERS = ["user", "username", "server", "memberCount"] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];

export type PlaceholderValues = Record<Placeholder, string>;

/** Replaces every {placeholder} with its value. Unknown ones are left as-is. */
export function renderTemplate(text: string, values: PlaceholderValues): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    return Object.prototype.hasOwnProperty.call(values, name)
      ? values[name as Placeholder]
      : match;
  });
}
