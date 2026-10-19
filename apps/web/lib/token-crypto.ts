import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Discord access and refresh tokens are kept encrypted in the database. The key
 * comes from AUTH_SECRET, which only the dashboard holds, so the bot, a copy of
 * the database file or a backup of it cannot use the tokens. Free of Next
 * imports so the tests can reach it.
 *
 * A token written before this existed is plain text. It is read as it is and
 * written back sealed the next time it is refreshed. A token that cannot be
 * opened, because AUTH_SECRET changed, reads as missing, and the person signs in
 * again, which they would have to do anyway.
 */

const PREFIX = "enc1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFor(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "tier0", "discord oauth tokens v1", 32));
}

function secretOf(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set. Copy .env.example to .env and fill it in.");
  return secret;
}

export function sealToken(plain: string, secret: string = secretOf()): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** The token, or null when it is sealed with a different key or has been altered. Plain text passes through. */
export function openToken(stored: string, secret: string = secretOf()): string | null {
  if (!stored.startsWith(PREFIX)) return stored;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
    if (raw.length < IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const isSealed = (stored: string): boolean => stored.startsWith(PREFIX);

interface Tokens {
  access_token?: string | null | undefined;
  refresh_token?: string | null | undefined;
  id_token?: string | null | undefined;
}

/** The token fields of an account with each one sealed, for the ones that are present. */
export function sealedTokenFields(account: Tokens, secret: string = secretOf()): Partial<Record<"access_token" | "refresh_token" | "id_token", string>> {
  return {
    ...(account.access_token ? { access_token: sealToken(account.access_token, secret) } : {}),
    ...(account.refresh_token ? { refresh_token: sealToken(account.refresh_token, secret) } : {}),
    ...(account.id_token ? { id_token: sealToken(account.id_token, secret) } : {}),
  };
}
