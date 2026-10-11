import Link from "next/link";
import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import type { FieldDescriptor } from "@tier0/core";
import { requireGuildAccess } from "../../../../lib/authz";
import { ControlApiError } from "../../../../lib/control-api";
import { guildModules } from "../../../../lib/guild-data";
import { statusLine, toModuleViews } from "../../../../lib/module-view";
import { availableFlows, hasGuidedSetup } from "../../../../lib/guided";
import { SECTIONS } from "../../../../lib/sections";
import { BotOffline } from "../../../../components/BotOffline";
import { ChevronRightIcon, InfoIcon } from "../../../../components/Icons";

export const metadata: Metadata = {
  title: "Quick setup",
};

/**
 * The way in for someone who does not yet know what any of it does. Both the
 * bundles and the one-feature runs below come from module metadata, so a new
 * module appears here as soon as its schema tags a field `guided`.
 */
export default async function QuickSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const access = await requireGuildAccess(id);
    if (!access.ok) {
      if (access.status === 401) redirect("/login");
      forbidden();
    }

    const modules = toModuleViews(await guildModules(id));
    const flows = availableFlows(modules.map((module) => module.id));
    const guided = modules.filter((module) =>
      hasGuidedSetup(module.schema as unknown as FieldDescriptor),
    );

    return (
      <>
        <div className="page-header">
          <div className="page-header-text">
            <p className="page-eyebrow">Quick setup</p>
            <h1 className="page-title">Set things up the short way</h1>
            <p className="page-summary">
              A few questions per feature instead of a page of settings. Each
              run turns the feature on as it goes, and everything it asks about
              can be changed afterwards.
            </p>
          </div>
        </div>

        {guided.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No feature offers a quick setup</p>
            <p className="empty-text">
              Every feature on this install is configured from its own settings
              page instead.
            </p>
            <div className="empty-actions">
              <Link className="btn btn-primary" href={`/guilds/${id}`}>
                Back to the server
              </Link>
            </div>
          </div>
        ) : null}

        {flows.length > 0 ? (
          <section>
            <div className="section-title">
              <h2>Set up in one go</h2>
              <p>
                These cover several features that are worth deciding together.
              </p>
            </div>
            <div className="flow-grid">
              {flows.map((flow) => (
                <Link key={flow.id} className="flow-card" href={`/guilds/${id}/setup/${flow.id}`}>
                  <span className="flow-card-title">{flow.title}</span>
                  <span className="flow-card-blurb">{flow.blurb}</span>
                  <span className="flow-card-foot">
                    <span className="flow-card-meta">
                      {flow.modules.length === 1
                        ? "1 feature"
                        : `${flow.modules.length} features`}
                    </span>
                    <span className="flow-card-go">
                      Start
                      <ChevronRightIcon />
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {guided.length > 0 ? (
          <section>
            <div className="section-title">
              <h2>One feature at a time</h2>
              <p>
                The same questions, for a single feature. Run any of these
                whenever you want, however many times you want.
              </p>
            </div>
            <div className="card">
              <ul className="wizard-outcome-list">
                {guided.map((module) => {
                  const section = SECTIONS.find((entry) => entry.id === module.category);
                  return (
                    <li key={module.id}>
                      <Link
                        className="wizard-outcome"
                        href={`/guilds/${id}/${module.id}/setup`}
                      >
                        <span className="dot" data-status={module.status} aria-hidden="true" />
                        <span className="wizard-outcome-text">
                          <span className="wizard-outcome-name">{module.name}</span>
                          <span className="wizard-outcome-summary">
                            {section ? `${section.heading} · ` : ""}
                            {statusLine(module.status, module.missing)}
                          </span>
                        </span>
                        <ChevronRightIcon className="chevron" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        ) : null}

        <div className="wizard-callouts">
          <div className="callout callout-info">
            <InfoIcon />
            <div>
              Prefer to see everything at once? Each feature&apos;s own page has
              every setting it has, and nothing here is a shortcut you cannot
              undo there. The <Link href="/help">help page</Link> explains what
              each feature does.
            </div>
          </div>
        </div>
      </>
    );
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    return <BotOffline />;
  }
}
