"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "./form";
import { AlertIcon, ChevronRightIcon } from "./Icons";
import { useToast } from "./Toaster";
import { UNREACHABLE, readFailure } from "../lib/bot-errors";
import { permissionLabel } from "../lib/invite";
import { settleToggle } from "../lib/serial-toggle";
import { moduleStatus } from "../lib/module-status";
import { moduleHref } from "../lib/module-href";
import { hasSettings, sectionHeading } from "../lib/sections";
import { statusLine, type ModuleView } from "../lib/module-view";

interface Props {
  guildId: string;
  module: ModuleView;
  /** Position in the grid, which sets the stagger delay of the entrance. */
  index?: number;
  animate?: boolean;
  /** Discord permissions the feature needs that the bot does not have on this server. */
  missingPermissions?: string[];
}

/**
 * One feature on the overview. The switch writes straight through: there is
 * nothing to review before turning a feature on, and the request only returns
 * once the bot has applied it.
 */
export function ModuleTile({ guildId, module, index = 0, animate = false, missingPermissions = [] }: Props) {
  const router = useRouter();
  const { push } = useToast();
  const [enabled, setEnabled] = useState(module.enabled);
  const [pending, setPending] = useState(false);

  // Presses only move what is wanted; one request at a time carries it to the bot.
  const state = useRef({ wanted: module.enabled, confirmed: module.enabled });
  const busy = useRef(false);

  useEffect(() => {
    if (busy.current) return;
    setEnabled(module.enabled);
    state.current = { wanted: module.enabled, confirmed: module.enabled };
  }, [module.enabled]);

  const status = moduleStatus(enabled, module.missing);

  async function toggle(next: boolean) {
    state.current.wanted = next;
    setEnabled(next);
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const outcome = await settleToggle(state.current, async (target) => {
      try {
        const res = await fetch(`/api/guilds/${guildId}/modules/${module.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: target }),
        });
        return res.ok ? { ok: true } : { ok: false, detail: (await readFailure(res)).message };
      } catch {
        return { ok: false, detail: UNREACHABLE };
      }
    });
    busy.current = false;
    setPending(false);
    setEnabled(state.current.confirmed);
    if (outcome.failure) {
      push({
        kind: "error",
        title: `${module.name} is still ${outcome.failure.target ? "off" : "on"}`,
        detail: outcome.failure.detail,
      });
    }
    if (outcome.changed) router.refresh();
  }

  return (
    <div
      className={animate ? "module-tile rise" : "module-tile"}
      style={animate ? ({ "--i": index } as CSSProperties) : undefined}
    >
      <div className="module-tile-head">
        <div className="module-tile-title">
          <div className="module-tile-eyebrow">{sectionHeading(module.category)}</div>
          <div className="module-tile-name">{module.name}</div>
        </div>
        <Switch checked={enabled} onChange={toggle} pending={pending} aria-label={module.name} />
      </div>

      <p className="module-tile-summary">{module.summary}</p>

      {missingPermissions.length > 0 ? (
        <p className="module-tile-perms">
          <AlertIcon />
          <span>
            The bot is missing {missingPermissions.map(permissionLabel).join(", ")}. Give its role{" "}
            {missingPermissions.length === 1 ? "that permission" : "those permissions"} in Server Settings, Roles.
          </span>
        </p>
      ) : null}

      <div className="module-tile-foot">
        <span className="module-tile-status" data-status={status}>
          <span className="dot" data-status={status} aria-hidden="true" />
          <span className="module-tile-status-text">{statusLine(status, module.missing)}</span>
        </span>
        <Link className="module-tile-link" href={hasSettings(module) ? moduleHref(guildId, module) : `/guilds/${guildId}/commands`}>
          {hasSettings(module) ? "Configure" : "Commands"}
          <ChevronRightIcon />
        </Link>
      </div>
    </div>
  );
}
