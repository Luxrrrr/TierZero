"use client";

import { useEffect } from "react";
import type { FieldDescriptor, MessageBody, TicketContextDto, TicketPanelStatusDto } from "@tier0/core";
import { ModulePage } from "../ModulePage";
import { AlertIcon } from "../Icons";
import type { ModuleView } from "../../lib/module-view";
import { healthHeadline, needsFirstRun, shownIssues } from "../../lib/ticket-health";
import { BlockedMembers } from "./BlockedMembers";
import { FirstRun } from "./FirstRun";
import { HealthCard } from "./HealthCard";
import { PanelStrip } from "./PanelStrip";
import { followSettingsAddress, openSettingsTarget } from "./settings-target";

interface Props {
  guildId: string;
  serverName: string;
  module: ModuleView;
  /** Null when the bot could not say, which leaves the health card out rather than showing a guess. */
  context: TicketContextDto | null;
  panels: TicketPanelStatusDto[] | { error: string };
}

/** The message a new panel starts with, read from the schema so the preview matches the bot's default. */
function panelStarting(schema: FieldDescriptor): MessageBody | undefined {
  const panels = (schema.fields as Record<string, FieldDescriptor> | undefined)?.panels;
  const row = (panels?.of as FieldDescriptor | undefined)?.fields as Record<string, FieldDescriptor> | undefined;
  return row?.message?.starting as MessageBody | undefined;
}

/**
 * The Settings tab of Tickets: the ordinary schema form, split into its
 * sections, with what the bot knows about the live server around it: what
 * is broken, whether each panel is up, and what the commands do.
 *
 * The full health card sits with Panels, where nearly every fix is. Other
 * parts carry a one-line note while something stops tickets opening, rather
 * than the whole card above every part.
 */
export function TicketsSettings({ guildId, serverName, module, context, panels }: Props) {
  const schema = module.schema as unknown as FieldDescriptor;
  const starting = panelStarting(schema);
  const contextPanels = context?.panels ?? [];

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
      sectionIntro={({ settings, dirty, enabled, update }) => ({
        panels: (
          <>
            {context && !(firstRun && shown.length === 0) ? (
              <HealthCard guildId={guildId} issues={shown} panels={context.panels} summary={context.healthSummary} samePage />
            ) : null}
            <PanelStrip
              guildId={guildId}
              serverName={serverName}
              settings={settings}
              dirty={dirty}
              enabled={enabled}
              initial={panels}
              starting={starting}
              typeProblems={context?.panels ?? []}
              issues={context?.health ?? []}
            />
          </>
        ),
        general: <BlockedMembers guildId={guildId} settings={settings} disabled={false} onChange={update} />,
      })}
    />
  );
}
