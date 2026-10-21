"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BotProfile, BotProfileResult } from "../lib/control-api";
import { Field } from "./form/Field";
import { Select } from "./form/Select";
import { useToast } from "./Toaster";

const STATUS_OPTIONS = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Idle" },
  { value: "dnd", label: "Do not disturb" },
  { value: "invisible", label: "Invisible", description: "Shows as offline, but the bot still works." },
];

const ACTIVITY_OPTIONS = [
  { value: "none", label: "Nothing" },
  { value: "playing", label: "Playing" },
  { value: "watching", label: "Watching" },
  { value: "listening", label: "Listening to" },
  { value: "competing", label: "Competing in" },
  { value: "custom", label: "A custom status" },
];

const ACTIVITY_PREFIX: Record<string, string> = {
  playing: "Playing ",
  watching: "Watching ",
  listening: "Listening to ",
  competing: "Competing in ",
  custom: "",
};

const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
const NAME_MAX = 32;
const ACTIVITY_MAX = 128;

/** A picture as the text the bot takes. */
function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * The bot's name, picture, status and activity. The name and picture are the bot's on Discord, so a change shows in
 * every server it is in, and Discord limits how often they can be changed. Only the owner of the install can save.
 */
export function BotProfileForm({ profile, owner }: { profile: BotProfile; owner: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const nameId = useId();
  const statusId = useId();
  const activityId = useId();
  const textId = useId();
  const picker = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(profile.name ?? "");
  const [status, setStatus] = useState<string>(profile.presence.status);
  const [kind, setKind] = useState<string>(profile.presence.activityType);
  const [text, setText] = useState(profile.presence.activityText);
  /** undefined keeps the picture the bot has, null takes it off, text is a new one. */
  const [avatar, setAvatar] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const shownAvatar = avatar === undefined ? profile.avatarUrl : avatar;
  const changed =
    name.trim() !== (profile.name ?? "") ||
    status !== profile.presence.status ||
    kind !== profile.presence.activityType ||
    (kind !== "none" && text.trim() !== profile.presence.activityText) ||
    avatar !== undefined;

  async function choose(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      toast.push({ kind: "error", title: "That is not a picture the bot can use", detail: "Choose a PNG, JPEG, GIF or WebP image." });
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.push({ kind: "error", title: "That picture is too large", detail: "Choose one under 8 MB." });
      return;
    }
    setAvatar(await readAsDataUri(file));
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/bot-profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          presence: { status, activityType: kind, activityText: kind === "none" ? "" : text },
          ...(name.trim() !== (profile.name ?? "") ? { name } : {}),
          ...(avatar !== undefined ? { avatar } : {}),
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null;
        toast.push({ kind: "error", title: "That did not save", detail: typeof detail === "string" ? detail : "Try again in a moment." });
        return;
      }
      const result = (data as { result: BotProfileResult }).result;
      const failures: string[] = [];
      if (typeof result.name === "object") failures.push(`The name was not changed: ${result.name.failed}`);
      if (typeof result.avatar === "object") failures.push(`The picture was not changed: ${result.avatar.failed}`);
      if (failures.length > 0) toast.push({ kind: "error", title: "Part of it did not save", detail: failures.join(" ") });
      else toast.push({ kind: "success", title: "Saved" });
      setAvatar(undefined);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const line = kind === "none" ? "" : `${ACTIVITY_PREFIX[kind] ?? ""}${text.trim()}`;

  return (
    <div className="bot-profile">
      <div className="card bot-profile-card">
        <div className="card-body bot-profile-body">
          <div className="bot-preview" aria-label="How the bot looks in a member list">
            <span className="bot-preview-avatar">
              {shownAvatar ? <img src={shownAvatar} alt="" width={64} height={64} /> : <span aria-hidden="true">{(name.trim()[0] ?? "?").toUpperCase()}</span>}
              <span className="bot-preview-dot" data-status={status} aria-hidden="true" />
            </span>
            <span className="bot-preview-text">
              <span className="bot-preview-name">{name.trim() || profile.name || "The bot"}</span>
              <span className="bot-preview-line">{line || "No activity"}</span>
            </span>
          </div>

          {owner ? (
            <div className="bot-avatar-actions">
              <input ref={picker} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(event) => void choose(event.target.files?.[0])} />
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => picker.current?.click()}>
                Choose a picture
              </button>
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy || avatar === null || (avatar === undefined && !profile.hasAvatar)} onClick={() => setAvatar(null)}>
                Remove it
              </button>
              {avatar !== undefined ? (
                <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setAvatar(undefined)}>
                  Keep the current one
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="form-grid">
        <Field
          id={nameId}
          label="Name"
          help="What the bot is called in every server it is in. Discord limits how often a bot can change it, so a second change within the hour may be refused."
          hint={`${[...name.trim()].length}/${NAME_MAX}`}
          disabled={!owner}
        >
          {(chrome) => (
            <input id={chrome.id} className="input" value={name} maxLength={NAME_MAX} disabled={chrome.disabled} aria-describedby={chrome.describedBy} onChange={(event) => setName(event.target.value)} />
          )}
        </Field>

        <Field id={statusId} label="Status" help="The dot beside the bot in the member list." disabled={!owner}>
          {(chrome) => <Select id={chrome.id} options={STATUS_OPTIONS} value={status} onChange={setStatus} disabled={chrome.disabled} aria-describedby={chrome.describedBy} />}
        </Field>

        <Field id={activityId} label="Activity" help="The line under the bot's name, such as Playing a game or Watching the server." disabled={!owner}>
          {(chrome) => <Select id={chrome.id} options={ACTIVITY_OPTIONS} value={kind} onChange={setKind} disabled={chrome.disabled} aria-describedby={chrome.describedBy} />}
        </Field>

        {kind !== "none" ? (
          <Field id={textId} label="What it says" hint={`${[...text].length}/${ACTIVITY_MAX}`} disabled={!owner}>
            {(chrome) => (
              <input id={chrome.id} className="input" value={text} maxLength={ACTIVITY_MAX} disabled={chrome.disabled} aria-describedby={chrome.describedBy} onChange={(event) => setText(event.target.value)} />
            )}
          </Field>
        ) : null}
      </div>

      {owner ? (
        <div className="bot-profile-foot">
          <button type="button" className="btn btn-primary" disabled={busy || !changed} onClick={() => void save()}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      ) : (
        <p className="field-help">Only the owner of this install can change how the bot shows.</p>
      )}
    </div>
  );
}
