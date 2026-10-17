"use client";

import Link from "next/link";
import type { TicketHealthIssue, TicketHealthSummary, TicketPanelOption } from "@tier0/core";
import { AlertIcon, CheckIcon, WarnTriangleIcon } from "../Icons";
import { healthHeadline, healthLines } from "../../lib/ticket-health";
import { openSettingsTarget } from "./settings-target";

/**
 * What is wrong with this server's tickets right now, in plain words, each
 * with the place it is fixed. On the settings page itself a fix opens the
 * panel or type it is about rather than loading a page.
 */
export function HealthCard({
  guildId,
  issues,
  panels,
  summary,
  samePage = false,
}: {
  guildId: string;
  /** The issues to list, which is what the heading counts. */
  issues: TicketHealthIssue[];
  panels: TicketPanelOption[];
  /** The bot's count of which types are stopped, when it sent one. */
  summary?: TicketHealthSummary | null;
  samePage?: boolean;
}) {
  const lines = healthLines(guildId, issues, panels);

  if (lines.length === 0) {
    return (
      <section className="mod-card tk-health tk-health--ok" aria-label="Health">
        <p className="tk-health-ok">
          <span className="tk-health-icon" data-tone="ok" aria-hidden="true">
            <CheckIcon />
          </span>
          <span>
            <strong>Everything is in place.</strong> Members can open tickets and the bot has the permissions it needs.
          </span>
        </p>
      </section>
    );
  }

  const headline = healthHeadline(issues, panels, summary);
  return (
    <section className="mod-card tk-health" aria-labelledby="tk-health-title">
      <div className="mod-card-head">
        <div>
          <h2 className="mod-card-title" id="tk-health-title">
            {headline.title}
          </h2>
          <p className="mod-card-desc">{headline.detail}</p>
        </div>
      </div>
      <ul className="tk-health-list">
        {lines.map((line, index) => (
          <li key={`${line.code}-${index}`} className="tk-health-item" data-tone={line.tone}>
            <span className="tk-health-icon" data-tone={line.tone} aria-hidden="true">
              {line.tone === "danger" ? <AlertIcon /> : <WarnTriangleIcon />}
            </span>
            <div className="tk-health-text">
              <p className="tk-health-title">
                {line.title}
                <span className="visually-hidden">{line.tone === "danger" ? ", stops tickets opening" : ""}</span>
              </p>
              <p className="tk-health-detail">{line.detail}</p>
            </div>
            {line.fix ? (
              samePage ? (
                <a
                  className="btn btn-secondary btn-sm"
                  href={line.fix.href.slice(line.fix.href.indexOf("#"))}
                  onClick={(event) => {
                    event.preventDefault();
                    void openSettingsTarget(line.target, panels);
                  }}
                >
                  {line.fix.label}
                </a>
              ) : (
                <Link className="btn btn-secondary btn-sm" href={line.fix.href}>
                  {line.fix.label}
                </Link>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
