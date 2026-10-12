"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertIcon } from "../../../../../components/Icons";
import { useToast } from "../../../../../components/Toaster";
import { HoldButton } from "./HoldButton";

interface Row {
  id: string;
  title: string;
  detail: string;
}

const ROWS: Row[] = [
  {
    id: "mod-logs",
    title: "Member actions",
    detail: "Every warn, timeout, kick and ban on every member's record, with the messages attached to them. Members' totals go back to zero.",
  },
  {
    id: "staff-activity",
    title: "Staff activity",
    detail: "Everything staff did in this dashboard. One entry stays, saying you deleted it.",
  },
  {
    id: "server-events",
    title: "Server log events",
    detail: "Joins, leaves, role and channel changes, voice activity and everything else in the event log.",
  },
  {
    id: "saved-messages",
    title: "Saved messages",
    detail: "The text of every message the logs kept, with its edits. Copies already attached to a case stay on the case.",
  },
];

/**
 * Deleting whole logs for good. Tick any number of them, then hold one button for three seconds to delete
 * everything ticked. Only the owner can open this page, and nothing here can be undone.
 */
export function DangerZone({ guildId }: { guildId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const all = picked.length === ROWS.length;
  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  async function remove() {
    if (picked.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/mod/danger?targets=${picked.join(",")}`, { method: "DELETE" });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null;
        toast.push({ kind: "error", title: "Nothing was deleted", detail: typeof detail === "string" ? detail : "Try again in a moment." });
        return;
      }
      const deleted = data && typeof data === "object" && "deleted" in data ? Number((data as { deleted: unknown }).deleted) : 0;
      toast.push({ kind: "success", title: `Deleted ${deleted.toLocaleString("en")} ${deleted === 1 ? "item" : "items"}` });
      setPicked([]);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="danger-zone" id="danger-zone" aria-labelledby="danger-title">
      <div className="danger-head">
        <span className="danger-icon" aria-hidden="true">
          <AlertIcon />
        </span>
        <div>
          <h2 className="danger-title" id="danger-title">
            Danger zone
          </h2>
          <p className="danger-desc">
            Permanently deletes the logs you pick for this server. Only the owner can do this. Tick the logs, then hold the button for three seconds.
          </p>
        </div>
      </div>

      <div className="danger-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(all ? [] : ROWS.map((row) => row.id))}>
          {all ? "Untick all" : "Tick all"}
        </button>
        <span className="danger-count" role="status">
          {picked.length === 0 ? "Nothing ticked" : `${picked.length} of ${ROWS.length} ticked`}
        </span>
      </div>

      <ul className="danger-list">
        {ROWS.map((row) => (
          <li key={row.id}>
            <label className="danger-row" data-picked={picked.includes(row.id) ? "true" : undefined}>
              <input type="checkbox" checked={picked.includes(row.id)} disabled={busy} onChange={() => toggle(row.id)} />
              <span className="danger-row-text">
                <span className="danger-row-title">{row.title}</span>
                <span className="danger-row-detail">{row.detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="danger-foot">
        <HoldButton
          label={picked.length === 0 ? "Tick a log to delete" : busy ? "Deleting…" : `Hold to delete ${picked.length} ${picked.length === 1 ? "log" : "logs"}`}
          disabled={busy || picked.length === 0}
          onConfirm={remove}
        />
      </div>
    </section>
  );
}
