"use client";

import { useState } from "react";

/** A command to run, with a button that copies it. Falls back to selecting nothing when the clipboard is blocked. */
export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="copy-command">
      <code>{command}</code>
      <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
