"use client";

import { useState } from "react";
import type { FieldDescriptor } from "@tier0/core";
import { SettingsForm } from "../../../components/SettingsForm";
import type { GuildModuleState } from "../../../lib/control-api";

interface Props {
  guildId: string;
  guildName: string;
  modules: GuildModuleState[];
}

export function GuildDashboard({ guildId, guildName, modules }: Props) {
  return (
    <main>
      <h1>{guildName}</h1>
      {modules.length === 0 ? (
        <p>No modules are registered yet.</p>
      ) : (
        modules.map((module) => <ModuleCard key={module.id} guildId={guildId} module={module} />)
      )}
    </main>
  );
}

function ModuleCard({ guildId, module }: { guildId: string; module: GuildModuleState }) {
  const [enabled, setEnabled] = useState(module.enabled);
  const [settings, setSettings] = useState<Record<string, unknown>>(module.settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  async function save() {
    setSaving(true);
    setJustSaved(false);
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
        return;
      }

      setJustSaved(true);
    } catch {
      setErrors({ "": "Couldn't reach the dashboard server. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="module-card">
      <header>
        <div>
          <h2>{module.name}</h2>
          <p>{module.summary}</p>
        </div>
        <label>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </header>

      {errors[""] ? <p className="error-banner">{errors[""]}</p> : null}

      <SettingsForm
        schema={module.schema as unknown as FieldDescriptor}
        value={settings}
        guildId={guildId}
        onChange={setSettings}
        errors={errors}
      />

      <button type="button" disabled={saving} onClick={save}>
        {saving ? "Saving…" : "Save"}
      </button>
      {justSaved ? <span> Saved.</span> : null}
    </section>
  );
}
