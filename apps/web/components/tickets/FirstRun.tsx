"use client";

import Link from "next/link";
import type { TicketHealthIssue, TicketPanelOption } from "@tier0/shared-tickets";
import { CheckIcon, SetupIcon, TicketIcon } from "../Icons";
import { firstRunHref, firstRunSteps } from "../../lib/ticket-health";
import { openSettingsTarget } from "./settings-target";

/**
 * What a server needs before its first ticket, as three steps with a button
 * each that opens the setting the step is about. Someone who cannot change
 * the settings is told who can instead of being shown buttons that would
 * refuse them.
 */
export function FirstRun({
  guildId,
  panels,
  health,
  canManage,
  samePage = false,
}: {
  guildId: string;
  panels: TicketPanelOption[];
  health: TicketHealthIssue[];
  canManage: boolean;
  /** Drawn on the settings page itself, where each button opens the row it is about rather than loading a page. */
  samePage?: boolean;
}) {
  const steps = firstRunSteps({ panels, health });
  const next = steps.find((step) => !step.done)?.id;

  return (
    <section className="mod-card tk-firstrun" aria-labelledby="tk-firstrun-title">
      <div className="tk-firstrun-head">
        <span className="tk-firstrun-icon" aria-hidden="true">
          <TicketIcon />
        </span>
        <div>
          <h2 className="tk-firstrun-title" id="tk-firstrun-title">
            Set up tickets in three steps
          </h2>
          <p className="tk-firstrun-text">
            Members press a button on a panel to open a private conversation with your team. Their tickets then arrive
            here, where staff can answer them without leaving the dashboard.
          </p>
        </div>
      </div>
      <ol className="tk-steps">
        {steps.map((step, index) => {
          const href = firstRunHref(guildId, step);
          const className = step.id === next ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm";
          return (
            <li key={step.id} className="tk-step" data-done={step.done ? "true" : undefined} data-next={step.id === next ? "true" : undefined}>
              <span className="tk-step-marker" aria-hidden="true">
                {step.done ? <CheckIcon /> : index + 1}
              </span>
              <div className="tk-step-text">
                <p className="tk-step-title">
                  {step.title}
                  {step.done ? <span className="visually-hidden">, done</span> : null}
                </p>
                <p className="tk-step-detail">{step.detail}</p>
              </div>
              {canManage && !step.done ? (
                samePage ? (
                  <a
                    className={className}
                    href={href.slice(href.indexOf("#"))}
                    onClick={(event) => {
                      event.preventDefault();
                      void openSettingsTarget(step.target, panels, { post: step.id === "post" });
                    }}
                  >
                    {step.action}
                  </a>
                ) : (
                  <Link className={className} href={href}>
                    {step.action}
                  </Link>
                )
              ) : null}
            </li>
          );
        })}
      </ol>
      {canManage ? (
        <p className="tk-firstrun-foot">
          <SetupIcon />
          <span>
            Prefer to be asked? <Link href={`/guilds/${guildId}/tickets/setup`}>Quick setup</Link> asks the same three things
            and ends by posting the panel.
          </span>
        </p>
      ) : (
        <p className="tk-firstrun-foot">
          Someone with the Manage Server permission sets this up, under Tickets, then Settings.
        </p>
      )}
    </section>
  );
}
