import Link from "next/link";
import type { UpdateStatus } from "../lib/updates";
import { compareVersions } from "../lib/version";
import { ReleaseNotes } from "./ReleaseNotes";
import { RoadmapList } from "./RoadmapList";
import { CopyCommand } from "../app/updates/CopyCommand";
import { UpdateActions } from "../app/updates/UpdateActions";

/** A release is titled "TierZero v0.2.1 (beta)" and the tag is already shown beside it, so only what is left is worth saying. */
function releaseLabel(name: string, tag: string): string {
  return name.replace(/^TierZero\s+/i, "").replace(tag, "").replace(tag.replace(/^v/, ""), "").trim();
}

const dayFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * The body of the Updates page: the version this install runs, whether a newer one is out, how to update, the
 * changelog and the roadmap. The page around it differs, since one sits inside a server's navigation and one does
 * not, but this is the same either way.
 */
export function UpdatesContent({ status, owner }: { status: UpdateStatus; owner: boolean }) {
  const newer = status.releases.filter((release) => compareVersions(release.tag, status.current) > 0);
  return (
    <>
    <div className="page-header">
      <div className="page-header-text">
        <p className="page-eyebrow">Updates</p>
        <h1 className="page-title">Updates and changelog</h1>
        <p className="page-summary">What version this install is, what has changed since, and what is coming.</p>
      </div>
    </div>

    <section className="update-card" data-state={status.updateAvailable ? "new" : "current"} aria-labelledby="update-status">
      <div className="update-card-main">
        <p className="update-version">
          You are on <strong>v{status.current}</strong>
        </p>
        <h2 id="update-status" className="update-title">
          {!status.enabled
            ? "Update checks are off"
            : status.updateAvailable && status.latest
              ? `${status.latest.tag} is available`
              : status.latest
                ? "You are up to date"
                : "Could not check for updates"}
        </h2>
        <p className="update-sub">
          {!status.enabled
            ? "This install is not asking GitHub for anything. Turn checks on to see new releases here."
            : status.checkedAt
              ? `Last checked ${dayFormat.format(new Date(status.checkedAt))}${status.error ? `. The latest check failed: ${status.error}.` : "."}`
              : status.error
                ? `GitHub could not be reached: ${status.error}. This install may be offline.`
                : "Not checked yet."}
        </p>
        {status.updateAvailable && status.latest ? (
          <p>
            <a className="btn btn-primary btn-sm" href={status.latest.url} target="_blank" rel="noreferrer">
              Read the release notes
            </a>
          </p>
        ) : null}
      </div>
      {owner ? <UpdateActions enabled={status.enabled} /> : null}
    </section>

    <section className="update-section" aria-labelledby="how-to-update">
      <h2 id="how-to-update">How to update</h2>
      <p className="update-text">
        Run these on the machine the bot runs on, in the folder you installed it in. Copy <code>data/tier0.db</code> first, because
        database changes only go forward and the copy is how you go back.
      </p>
      <CopyCommand command="git pull" />
      <CopyCommand command="docker compose up -d --build" />
      <p className="update-text">
        The dashboard restarts and applies any database changes on its own. The <Link href="/help">help page</Link> and the install guide cover
        running from source and going back to an older version.
      </p>
    </section>

    <section className="update-section" aria-labelledby="changelog">
      <h2 id="changelog">Changelog</h2>
      {status.releases.length === 0 ? (
        <p className="update-text">
          {status.enabled ? "No releases could be loaded." : "Turn update checks on to load the changelog."} It is also on{" "}
          <a href="https://github.com/Luxrrrr/TierZero/releases" target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </p>
      ) : (
        <ol className="release-list">
          {status.releases.map((release, index) => {
            const isCurrent = compareVersions(release.tag, status.current) === 0;
            const isNew = newer.includes(release);
            return (
              <li key={release.tag} className="release" data-new={isNew ? "true" : undefined} data-current={isCurrent ? "true" : undefined}>
                <details open={index < 2 || isCurrent || isNew}>
                  <summary>
                    <span className="release-tag">{release.tag}</span>
                    {releaseLabel(release.name, release.tag) ? <span className="release-name">{releaseLabel(release.name, release.tag)}</span> : null}
                    {isNew ? <span className="release-badge" data-kind="new">New</span> : null}
                    {isCurrent ? <span className="release-badge" data-kind="current">Installed</span> : null}
                    {release.prerelease ? <span className="release-badge">Pre-release</span> : null}
                    {release.publishedAt ? <span className="release-date">{dayFormat.format(new Date(release.publishedAt))}</span> : null}
                  </summary>
                  <ReleaseNotes body={release.body} title={release.name} />
                  <p className="release-link">
                    <a href={release.url} target="_blank" rel="noreferrer">
                      View on GitHub
                    </a>
                  </p>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>

    <section className="update-section" aria-labelledby="coming-soon">
      <h2 id="coming-soon">Coming soon</h2>
      <RoadmapList items={status.roadmap} />
    </section>
    </>
  );
}
