"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { FieldDescriptor, RowDescription } from "@tier0/core";
import { describeDuration } from "../../lib/duration";
import { arrayItemPath } from "../../lib/schema-paths";
import { stripIndices, summarizeRow, type RowLabels } from "../../lib/row-summary";
import { useChannels } from "./ChannelPicker";
import { ObjectList } from "./ObjectList";
import { useRoles } from "./RolePicker";
import { RowActionPanel, RowStatusLine, useRowActionRunner, useRowStatuses } from "./rowRuntime";

/**
 * What the form knows about the bot's side of a module's lists. Absent in the
 * quick setup, where rows have no status line and nothing to run.
 */
export interface RowsContext {
  moduleId: string;
  descriptions: Record<string, RowDescription>;
  /** Why actions cannot run right now, or null when they can. */
  locked: string | null;
  /** The draft differs from what is saved, so row positions may not match the bot's. */
  dirty: boolean;
  revision: number;
}

type Fields = Record<string, FieldDescriptor>;
type ActionInfo = RowDescription["actions"][number];

interface Props {
  guildId: string;
  /** The list's indexed path, e.g. `patchNotes.destinations[0].games`. */
  path: string;
  items: unknown[];
  itemFields: Fields;
  itemLabel: string;
  min?: number;
  max?: number;
  disabled: boolean;
  "aria-labelledby"?: string;
  rows: RowsContext | undefined;
  /** Every row starts open, as the quick setup wants. */
  openRows?: boolean;
  newItem(): unknown;
  /** A copy of a row for Duplicate, with fresh ids where the row carries any. */
  copyItem?(item: unknown): unknown;
  invalidAt(index: number): boolean;
  onChange(next: unknown[]): void;
  renderRow(item: unknown, index: number): ReactNode;
  /** Draws an action's inputs, which is the form renderer's job and not this file's. */
  actionInputs: {
    initial(input: FieldDescriptor): Record<string, unknown>;
    render(args: {
      input: FieldDescriptor;
      rowPath: string;
      actionId: string;
      value: Record<string, unknown>;
      onChange(next: Record<string, unknown>): void;
      errors: Record<string, string>;
      disabled: boolean;
    }): ReactNode;
  };
}

export function ObjectArray(props: Props) {
  const description = props.rows?.descriptions[stripIndices(props.path)];
  if (props.rows && description && (description.status || description.actions.length > 0)) {
    return <LiveList {...props} rows={props.rows} description={description} />;
  }
  return <ListView {...props} />;
}

interface ViewProps extends Props {
  headerStatus?(index: number): ReactNode;
  headerActions?(index: number): ReactNode;
  panel?(index: number): ReactNode;
  onRowRemoved?(index: number): void;
}

function ListView({
  guildId,
  path,
  items,
  itemFields,
  itemLabel,
  min,
  max,
  disabled,
  "aria-labelledby": labelledBy,
  newItem,
  copyItem,
  invalidAt,
  onChange,
  renderRow,
  headerStatus,
  headerActions,
  panel,
  onRowRemoved,
  openRows = false,
}: ViewProps) {
  const labels = useRowLabels(guildId, itemFields);
  return (
    <ObjectList
      items={items}
      min={min}
      max={max}
      itemLabel={itemLabel}
      disabled={disabled}
      aria-labelledby={labelledBy}
      listPath={path}
      startOpen={openRows}
      newItem={newItem}
      copyItem={copyItem}
      describe={(entry) => summarizeRow(asRecord(entry), itemFields, labels)}
      invalidAt={invalidAt}
      headerStatus={headerStatus}
      headerActions={headerActions}
      panel={panel}
      onRowRemoved={onRowRemoved}
      onChange={onChange}
    >
      {renderRow}
    </ObjectList>
  );
}

interface LiveProps extends Props {
  rows: RowsContext;
  description: RowDescription;
}

function LiveList(props: LiveProps) {
  const { guildId, path, rows, description, disabled, actionInputs } = props;
  const { moduleId, locked, dirty, revision } = rows;
  const baseId = useId();

  const statuses = useRowStatuses({
    guildId,
    moduleId,
    listPath: path,
    enabled: description.status,
    paused: dirty,
    revision,
  });
  // The bot's statuses are by position in the saved list. While there are
  // edits, a row keeps the status of the saved row it still matches exactly,
  // shown as possibly out of date, so moving rows does not move statuses onto
  // the wrong row and an edited row shows none.
  const savedRows = useRef<string[]>([]);
  if (!dirty) savedRows.current = props.items.map((item) => JSON.stringify(item));
  const runner = useRowActionRunner({ guildId, moduleId, onFinished: statuses.refresh });
  const [open, setOpen] = useState<{ index: number; actionId: string } | null>(null);

  useEffect(() => {
    // The panel runs against saved settings, so an edit makes it stale.
    if (locked) setOpen(null);
  }, [locked]);

  const buttonId = (index: number, actionId: string) => `${baseId}-run-${index}-${actionId}`;
  const reasonId = (index: number) => `${baseId}-locked-${index}`;

  const close = (returnFocusTo?: string) => {
    setOpen(null);
    if (returnFocusTo) document.getElementById(returnFocusTo)?.focus();
  };

  function onAction(index: number, action: ActionInfo) {
    if (action.input) {
      setOpen(
        open?.index === index && open.actionId === action.id
          ? null
          : { index, actionId: action.id },
      );
      return;
    }
    void runner.run(arrayItemPath(path, index), action, {});
  }

  const headerStatus = description.status
    ? (index: number) => {
        if (statuses.state.phase === "loading") return <RowStatusLine status="loading" />;
        if (statuses.state.phase !== "ready") return null;
        if (!dirty) {
          const status = statuses.state.statuses[index];
          return status ? <RowStatusLine status={status} /> : null;
        }
        const at = savedRows.current.indexOf(JSON.stringify(props.items[index]));
        const status = at === -1 ? null : statuses.state.statuses[at];
        return status ? <RowStatusLine status={status} stale /> : null;
      }
    : undefined;

  const headerActions =
    description.actions.length > 0
      ? (index: number) => (
          <>
            {locked ? (
              <span className="visually-hidden" id={reasonId(index)}>
                {locked}
              </span>
            ) : null}
            {description.actions.map((action) => {
              const active = open?.index === index && open.actionId === action.id;
              const busy = runner.running === `${arrayItemPath(path, index)}#${action.id}`;
              return (
                <button
                  key={action.id}
                  type="button"
                  id={buttonId(index, action.id)}
                  className="btn btn-secondary btn-sm"
                  disabled={disabled || locked !== null || runner.running !== null}
                  title={locked ?? action.help}
                  aria-describedby={locked ? reasonId(index) : undefined}
                  aria-expanded={action.input ? active : undefined}
                  onClick={() => onAction(index, action)}
                >
                  {busy ? <span className="spinner" aria-hidden="true" /> : null}
                  {action.label}
                </button>
              );
            })}
          </>
        )
      : undefined;

  const panel = (index: number) => {
    if (!open || open.index !== index) return null;
    const action = description.actions.find((entry) => entry.id === open.actionId);
    if (!action?.input) return null;
    const rowPath = arrayItemPath(path, index);
    const input = action.input;
    return (
      <RowActionPanel
        key={`${index}:${action.id}`}
        action={action}
        initial={actionInputs.initial(input)}
        running={runner.running === `${rowPath}#${action.id}`}
        renderFields={({ value, onChange, errors, disabled: busy }) =>
          actionInputs.render({
            input,
            rowPath,
            actionId: action.id,
            value,
            onChange,
            errors,
            disabled: busy,
          })
        }
        run={(value) => runner.run(rowPath, action, value)}
        onClose={() => close(buttonId(index, action.id))}
      />
    );
  };

  return (
    <ListView
      {...props}
      headerStatus={headerStatus}
      headerActions={headerActions}
      panel={panel}
      onRowRemoved={() => setOpen(null)}
    />
  );

}

/**
 * Names for the ids a collapsed row mentions. The lists come through the same
 * cached fetches the pickers use, and are only requested when a row has a
 * field of that kind.
 */
function useRowLabels(guildId: string, fields: Fields): RowLabels {
  // A list of roles or channels is named in the summary too, so it needs the same lookups.
  const kinds = Object.values(fields).map((field) =>
    field.kind === "array" ? ((field.of as FieldDescriptor | undefined)?.kind ?? "array") : field.kind,
  );
  const { channels, failed: channelsFailed } = useChannels(guildId, kinds.includes("channel"));
  const { roles, failed: rolesFailed } = useRoles(guildId, kinds.includes("role"));

  return useMemo<RowLabels>(() => {
    const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
    const roleNames = new Map(roles.map((role) => [role.id, role.name]));
    // A list that failed to load says nothing about whether the saved one still exists.
    return {
      channel: (id) => {
        const name = channelNames.get(id);
        if (name !== undefined) return `#${name}`;
        return channelsFailed ? "a saved channel" : "unknown channel";
      },
      role: (id) => {
        const name = roleNames.get(id);
        if (name !== undefined) return `@${name}`;
        return rolesFailed ? "a saved role" : "unknown role";
      },
      duration: describeDuration,
    };
  }, [channels, roles, channelsFailed, rolesFailed]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
