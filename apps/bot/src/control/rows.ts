import type { Guild } from "discord.js";
import { assignedRoles, resolveList, resolveRow, schemaPathOf, type ModuleRegistry } from "@tier0/core";
import type { RowStatus } from "@tier0/core";
import type { GuildState } from "../runtime/guild-state.js";
import { roleGrantProblems } from "../runtime/role-grants.js";

export interface Reply {
  status: number;
  body: unknown;
}

const NOT_FOUND: Reply = { status: 404, body: { error: "not found" } };

/** A table lookup that ignores inherited keys, so an id like "constructor" finds nothing instead of a function. */
function own<T>(table: Record<string, T> | undefined, key: string): T | undefined {
  return table && Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Status lines for every row of one list setting. */
export async function rowStatuses(
  registry: ModuleRegistry,
  state: GuildState,
  guild: Guild,
  moduleId: string,
  listPath: string,
): Promise<Reply> {
  const hook = own(registry.get(moduleId)?.rows, schemaPathOf(listPath) ?? "")?.status;
  if (!hook) return NOT_FOUND;

  const ctx = await state.context(guild, moduleId);
  if (!ctx) return NOT_FOUND;
  const rows = resolveList(ctx.settings, listPath);
  if (!rows) return NOT_FOUND;

  let statuses: (RowStatus | null)[];
  try {
    statuses = await hook({ ctx, path: listPath, rows });
  } catch (error) {
    console.error(`[${moduleId}] row status for ${listPath} failed:`, error);
    return { status: 500, body: { error: "could not read the status" } };
  }
  return { status: 200, body: { statuses } };
}

/** Runs one action against one row, using the settings as last saved. */
export async function runRowAction(
  registry: ModuleRegistry,
  state: GuildState,
  guild: Guild,
  moduleId: string,
  rowPath: string,
  actionId: string,
  rawInput: unknown,
  actor?: string,
): Promise<Reply> {
  const action = own(own(registry.get(moduleId)?.rows, schemaPathOf(rowPath) ?? "")?.actions, actionId);
  if (!action) return NOT_FOUND;

  if (!(await state.isEnabled(guild.id, moduleId))) {
    return { status: 200, body: { ok: false, message: "Turn this feature on first." } };
  }

  const ctx = await state.context(guild, moduleId);
  if (!ctx) return NOT_FOUND;
  const row = resolveRow(ctx.settings, rowPath);
  if (!row) {
    return {
      status: 200,
      body: { ok: false, message: "That entry is not in the saved settings. Save your changes, then try again." },
    };
  }

  let input: Record<string, unknown> = {};
  if (action.input) {
    const parsed = action.input.parse(rawInput ?? {});
    if (!parsed.ok) return { status: 422, body: { errors: parsed.errors } };
    input = parsed.value as Record<string, unknown>;
    const problems = await roleGrantProblems(guild, actor, assignedRoles(action.input.describe(), input));
    if (problems.length > 0) return { status: 422, body: { errors: problems } };
  }

  try {
    return { status: 200, body: await action.run({ ctx, row, input }) };
  } catch (error) {
    console.error(`[${moduleId}] action ${actionId} on ${rowPath} failed:`, error);
    return { status: 200, body: { ok: false, message: "Something went wrong. Check the bot's log." } };
  }
}

/** Runs an action that belongs to the whole module, using the settings as last saved. */
export async function runModuleAction(
  registry: ModuleRegistry,
  state: GuildState,
  guild: Guild,
  moduleId: string,
  actionId: string,
  rawInput: unknown,
  actor?: string,
): Promise<Reply> {
  const action = own(registry.get(moduleId)?.actions, actionId);
  if (!action) return NOT_FOUND;

  if (!(await state.isEnabled(guild.id, moduleId))) {
    return { status: 200, body: { ok: false, message: "Turn this feature on first." } };
  }

  const ctx = await state.context(guild, moduleId);
  if (!ctx) return NOT_FOUND;

  let input: Record<string, unknown> = {};
  if (action.input) {
    const parsed = action.input.parse(rawInput ?? {});
    if (!parsed.ok) return { status: 422, body: { errors: parsed.errors } };
    input = parsed.value as Record<string, unknown>;
    const problems = await roleGrantProblems(guild, actor, assignedRoles(action.input.describe(), input));
    if (problems.length > 0) return { status: 422, body: { errors: problems } };
  }

  try {
    return { status: 200, body: await action.run({ ctx, input }) };
  } catch (error) {
    console.error(`[${moduleId}] action ${actionId} failed:`, error);
    return { status: 200, body: { ok: false, message: "Something went wrong. Check the bot's log." } };
  }
}
