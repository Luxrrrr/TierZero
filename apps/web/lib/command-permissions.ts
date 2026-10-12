/**
 * The permissions an owner can require to see a command. Values are Discord's
 * permission bits as decimal strings, because several exceed what a JSON number
 * holds exactly.
 */

const CHOICES = [
  { bits: "2", label: "Kick Members" },
  { bits: "4", label: "Ban Members" },
  { bits: "8192", label: "Manage Messages" },
  { bits: "1099511627776", label: "Timeout Members" },
  { bits: "268435456", label: "Manage Roles" },
  { bits: "32", label: "Manage Server" },
  { bits: "8", label: "Administrator" },
] as const;

const ADMINISTRATOR = 8n;

export interface PermissionChoice {
  value: string;
  label: string;
  hint?: string;
  /** The choice that keeps how the command ships. */
  isDefault?: boolean;
  /** The permission on its own, without the sentence around it. */
  short?: string;
}

/** How a stored choice reads in the dropdown. */
function labelOf(bits: string): string {
  if (bits === "8") return "Administrators only";
  const name = CHOICES.find((choice) => choice.bits === bits)?.label;
  return name ? `Members or roles with the ${name} permission` : "Members or roles with the permissions the command sets";
}

/** The short name of a stored choice, for the summary under a command. */
export function shortLabel(bits: string): string {
  if (bits === "8") return "Administrators";
  return CHOICES.find((choice) => choice.bits === bits)?.label ?? "Restricted";
}

export function defaultLabel(defaultPermissions: string | null): string {
  return defaultPermissions === null ? "Everyone" : labelOf(defaultPermissions);
}

/**
 * The choices that are safe to offer for a command. One that already needs a
 * permission can only be made stricter, which the bot also enforces: loosening
 * /ban to everyone would hand a moderation command to people it never checks.
 */
export function permissionChoices(defaultPermissions: string | null): PermissionChoice[] {
  const base: PermissionChoice = {
    value: "",
    label: `${defaultLabel(defaultPermissions)} (default)`,
    hint: "How the command ships",
    isDefault: true,
    short: defaultLabel(defaultPermissions),
  };
  // "Everyone" is the default for these, so it is not offered a second time.
  if (defaultPermissions === null) {
    return [base, ...CHOICES.map((choice) => ({ value: choice.bits, label: labelOf(choice.bits), short: shortLabel(choice.bits) }))];
  }

  const current = BigInt(defaultPermissions);
  const stricter = CHOICES.filter((choice) => {
    const bits = BigInt(choice.bits);
    return bits !== current && (bits === ADMINISTRATOR || (bits & current) === current);
  });
  return [base, ...stricter.map((choice) => ({ value: choice.bits, label: labelOf(choice.bits), short: shortLabel(choice.bits) }))];
}
