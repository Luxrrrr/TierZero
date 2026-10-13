"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "../../components/form/Switch";
import { RefreshIcon } from "../../components/Icons";
import { useToast } from "../../components/Toaster";

/** Check now, and the switch for checking at all. Only the owner of the install is offered either. */
export function UpdateActions({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const labelId = useId();
  const hintId = useId();

  async function call(method: "POST" | "PUT", body?: unknown): Promise<unknown> {
    setBusy(true);
    try {
      const res = await fetch("/api/updates", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null;
        toast.push({ kind: "error", title: "That did not work", detail: typeof detail === "string" ? detail : "Try again in a moment." });
        return null;
      }
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    const data = (await call("POST")) as { error: string | null; updateAvailable: boolean } | null;
    if (!data) return;
    if (data.error) toast.push({ kind: "error", title: "Could not reach GitHub", detail: data.error });
    else toast.push({ kind: "success", title: data.updateAvailable ? "A new version is available" : "You are up to date" });
    router.refresh();
  }

  async function toggle() {
    const data = await call("PUT", { enabled: !enabled });
    if (data) {
      toast.push({ kind: "success", title: enabled ? "Update checks are off" : "Update checks are on" });
      router.refresh();
    }
  }

  return (
    <div className="update-actions">
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !enabled} onClick={check}>
        <RefreshIcon />
        Check now
      </button>
      <div className="update-toggle">
        <div className="update-toggle-text">
          <span id={labelId} className="update-toggle-title">
            Check for updates
          </span>
          <span id={hintId} className="update-toggle-hint">
            Asks GitHub for new releases and the roadmap. Nothing about your install is sent. Off means no requests at all.
          </span>
        </div>
        <Switch checked={enabled} disabled={busy} onChange={() => void toggle()} aria-labelledby={labelId} aria-describedby={hintId} />
      </div>
    </div>
  );
}
