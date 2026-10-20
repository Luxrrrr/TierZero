"use client";

import { useEffect } from "react";
import type { TicketContextDto, TicketPanelStatusDto } from "@tier0/shared-tickets";
import { ModulePage } from "../ModulePage";
import { AlertIcon } from "../Icons";
import type { ModuleView } from "../../lib/module-view";
import { healthHeadline, needsFirstRun, shownIssues } from "../../lib/ticket-health";
import { BlockedMembers } from "./BlockedMembers";
import { FirstRun } from "./FirstRun";
import { HealthCard } from "./HealthCard";
import { PanelFooter, PanelStatus, usePanelPosting } from "./PanelPosting";
import { followSettingsAddress, openSettingsTarget } from "./settings-target";

interface Props {
  guildId: string;
  serverName: string;
  module: ModuleView;
  /** Null when the bot could not say, which leaves the health card out rather than showing a guess. */
  context: TicketContextDto | null;
  panels: TicketPanelStatusDto[] | { error: string };
}

/**
 * The Settings tab of Tickets: the ordinary schema form, split into its
 * sections, with what the bot knows about the live server around it: what
 * is broken, whether each panel is up (in the header and at the foot of each
 * panel), and what the commands do.
 *
 * The full health card sits with Panels, where nearly every fix is. Other
 * parts carry a one-line note while something stops tickets opening, rather
 * than the whole card above every part.
 */
export function TicketsSettings({ guildId, serverName, module, context, panels }: Props) {
  const contextPanels = context?.panels ?? [];
  const posting = usePanelPosting(guildId, panels);

  // A link from the inbox or the health card names the panel or type to open.
  useEffect(() => {
    const timer = window.setTimeout(() => followSettingsAddress(contextPanels), 150);
    return () => window.clearTimeout(timer);
  }, []);

  const firstRun = context ? needsFirstRun(context) : false;
  const shown = context ? shownIssues(context) : [];
  const blocking = shown.filter((issue) => issue.blocking).length;
  const headline = context && blocking > 0 ? healthHeadline(shown, context.panels, context.healthSummary) : null;

  const lead = context ? (
    <div className="tk-settings-lead">
      {firstRun ? <FirstRun guildId={guildId} panels={context.panels} health={context.health} canManage samePage /> : null}
      {headline ? (
        <p className="callout callout-error tk-health-note">
          <AlertIcon />
          <span>
            <strong>{headline.title}.</strong>{" "}
            <a
              href="#section-panels"
              onClick={(event) => {
                event.preventDefault();
                void openSettingsTarget(null, contextPanels).then(() =>
                  document.querySelector<HTMLElement>(".tk-health")?.scrollIntoView({ block: "start" }),
                );
              }}
            >
              See what to fix under Panels
            </a>
          </span>
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <ModulePage
      embedded
      guildId={guildId}
      serverName={serverName}
      eyebrow="Tickets"
      module={module}
      lead={lead}
      rowSlots={({ settings, dirty, enabled }) => {
        const draft = { settings, dirty, enabled, typeProblems: context?.panels ?? [], issues: context?.health ?? [] };
        return {
          panels: {
            status: (index) => <PanelStatus posting={posting} index={index} draft={draft} />,
            footer: (index) => <PanelFooter posting={posting} index={index} draft={draft} />,
          },
        };
      }}
      sectionIntro={({ settings, update }) => ({
        panels: (
          <>
            {context && !(firstRun && shown.length === 0) ? (
              <HealthCard guildId={guildId} issues={shown} panels={context.panels} summary={context.healthSummary} samePage />
            ) : null}
          </>
        ),
        general: <BlockedMembers guildId={guildId} settings={settings} disabled={false} onChange={update} />,
      })}
    />
  );
}
