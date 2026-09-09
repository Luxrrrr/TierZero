"use client";

import { useState } from "react";
import type { FieldDescriptor } from "@tier0/core";
import { SettingsForm } from "../../../components/SettingsForm";
import type { GuildModuleState } from "../../../lib/control-api";
import { CheckIcon } from "../../../components/Icons";
import { CommandControls } from "../../../components/CommandControls";

interface Props {
  guildId: string;
  heading: string;
  description: string;
  modules: GuildModuleState[];
}

/** One dashboard section's worth of module cards, already filtered by category. */
export function GuildDashboard({ guildId, heading, description, modules }: Props) {
  return (
    <section className="section-panel">
      <h2>{heading}</h2>
      <p className="section-description">{description}</p>

      {modules.length === 0 ? (
        <div className="empty-state">
          <p>No modules are registered for this section yet.</p>
        </div>
      ) : (
        modules.map((module) => <ModuleCard key={module.id} guildId={guildId} module={module} />)
      )}
    </section>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function ModuleCard({ guildId, module }: { guildId: string; module: GuildModuleState }) {
  const [enabled, setEnabled] = useState(module.enabled);
  const [settings, setSettings] = useState<Record<string, unknown>>(module.settings);
  const [saved, setSaved] = useState({ enabled: module.enabled, settings: module.settings });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<SaveState>("idle");

  const dirty = enabled !== saved.enabled || JSON.stringify(settings) !== JSON.stringify(saved.settings);

  async function save() {
    setState("saving");
    setErrors({});
    try {
      const res = await fetch(`/api/guilds/${guildId}/modules/${module.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, settings }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string; errors?: { path: string; message: string }[] });
        if (body.errors?.length) {
          const next: Record<string, string> = {};
          for (const fieldError of body.errors) next[fieldError.path] = fieldError.message;
          setErrors(next);
        } else {
          setErrors({ "": body.error ?? "Saving failed. Try again." });
        }
        setState("error");
        return;
      }

      setSaved({ enabled, settings });
      setState("saved");
    } catch {
      setErrors({ "": "Couldn't reach the dashboard server. Check your connection and try again." });
      setState("error");
    }
  }

  return (
    <section className="module-card">
      <header>
        <div>
          <h2>
            {module.name}
            <span className={enabled ? "badge is-on" : "badge is-off"}>
              {enabled ? "Enabled" : "Disabled"}
            </span>
          </h2>
          <p>{module.summary}</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setState("idle");
            }}
          />
          {enabled ? "On" : "Off"}
        </label>
      </header>

      <div className="module-body" data-disabled={enabled ? undefined : "true"}>
        {errors[""] ? (
          <p className="error-banner" role="alert">
            {errors[""]}
          </p>
        ) : null}

        <SettingsForm
          schema={module.schema as unknown as FieldDescriptor}
          value={settings}
          guildId={guildId}
          onChange={(next) => {
            setSettings(next);
            setState("idle");
          }}
          errors={errors}
        />

        <CommandControls guildId={guildId} commands={module.commands} />
      </div>

      <div className="module-footer">
        <button type="button" className="btn btn-primary" disabled={state === "saving" || !dirty} onClick={save}>
          {state === "saving" ? <span className="spinner" aria-hidden="true" /> : null}
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        <SaveStatus state={state} dirty={dirty} />
      </div>
    </section>
  );
}

function SaveStatus({ state, dirty }: { state: SaveState; dirty: boolean }) {
  if (state === "saving") return null;
  if (state === "error") {
    return <span className="module-status is-error">Not saved</span>;
  }
  if (dirty) {
    return <span className="module-status">Unsaved changes</span>;
  }
  if (state === "saved") {
    return (
      <span className="module-status is-saved">
        <CheckIcon />
        Saved
      </span>
    );
  }
  return null;
}
