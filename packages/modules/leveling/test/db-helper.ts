import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * A throwaway SQLite database built from the real migrations, for tests that
 * touch the level table. DATABASE_URL has to be set
 * before @tier0/db is first imported, so this is called before that import.
 */
export function createTestDatabase(): { cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "tier0-leveling-"));
  const dbPath = join(dir, "test.db");
  const migrations = resolve(import.meta.dirname, "../../../db/prisma/migrations");

  const db = new DatabaseSync(dbPath);
  for (const entry of readdirSync(migrations).sort()) {
    try {
      db.exec(readFileSync(join(migrations, entry, "migration.sql"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  db.close();

  process.env.DATABASE_URL = "file:" + dbPath.split(String.fromCharCode(92)).join("/");
  delete process.env.INSTANCE_OWNER_ID;
  return { cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
