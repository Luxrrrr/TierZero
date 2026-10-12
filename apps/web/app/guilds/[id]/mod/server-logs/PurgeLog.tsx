"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrashIcon } from "../../../../../components/Icons";
import { useToast } from "../../../../../components/Toaster";

/** Deleting the whole log cannot be undone, so it asks twice and says how much goes. */
export function PurgeLog({ guildId }: { guildId: string; total?: number }) {
  const router = useRouter();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function purge() {
    setBusy(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/mod/server-logs`, { method: "DELETE" });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null;
        toast.push({ kind: "error", title: "The server logs were not deleted", detail: typeof detail === "string" ? detail : "Try again in a moment." });
        return;
      }
      const deleted = data && typeof data === "object" && "deleted" in data ? Number((data as { deleted: unknown }).deleted) : 0;
      toast.push({ kind: "success", title: `Deleted ${deleted.toLocaleString("en")} ${deleted === 1 ? "item" : "items"} from the server logs` });
      setAsking(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(true)}>
        <TrashIcon />
        Delete the logs
      </button>
    );
  }

  return (
    <div className="ml-purge" role="group" aria-label="Confirm deleting the server logs">
      <span>
        Delete every saved entry and message? This can&apos;t be undone.
      </span>
      <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={purge}>
        {busy ? "Deleting…" : "Delete everything"}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setAsking(false)}>
        Cancel
      </button>
    </div>
  );
}
