"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "./form";
import { AlertIcon, ChevronRightIcon } from "./Icons";
import { useToast } from "./Toaster";
import { UNREACHABLE, readFailure } from "../lib/bot-errors";
import { permissionLabel } from "../lib/invite";
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

  useEffect(() => setEnabled(module.enabled), [module.enabled]);

  const status = moduleStatus(enabled, module.missing);

  async function toggle(next: boolean) {
    setEnabled(next);
    setPending(true);
    try {
      const res = await fetch(`/api/guilds/${guildId}/modules/${module.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        const failure = await readFailure(res);
        setEnabled(!next);
        push({
          kind: "error",
          title: `${module.name} is still ${next ? "off" : "on"}`,
          detail: failure.message,
        });
        return;
      }
      router.refresh();
    } catch {
      setEnabled(!next);
      push({
        kind: "error",
        title: `${module.name} is still ${next ? "off" : "on"}`,
        detail: UNREACHABLE,
      });
    } finally {
      setPending(false);
    }
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
          {statusLine(status, module.missing)}
        </span>
        <Link className="module-tile-link" href={hasSettings(module) ? moduleHref(guildId, module) : `/guilds/${guildId}/commands`}>
          {hasSettings(module) ? "Configure" : "Commands"}
          <ChevronRightIcon />
        </Link>
      </div>
    </div>
  );
}
