import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ControlApiError, getPublicLeaderboard } from "../../../lib/control-api";
import { createRateLimit, isGuildId, pageLinks, pageParam, visitorKey, type PublicLeaderboard } from "../../../lib/leaderboard";
import { createTimedCache } from "../../../lib/timed-cache";
import "../leaderboard.css";

/*
 * Anyone can open this page without signing in, for a server whose owner
 * switched it on under Leveling. Everything on it comes from the bot's
 * read-only leaderboard route, which decides what may be shown.
 */

export const dynamic = "force-dynamic";

const limit = createRateLimit({ perVisitor: 30, overall: 600, windowMs: 60_000 });

// A board a few seconds old is as good as a fresh one. Serving it from here means the bot is asked about a
// page at most once in that time however many people open it, and only a request for a page that is not
// kept counts against the limit above.
const boards = createTimedCache<PublicLeaderboard>({ ttlMs: 15_000, maxEntries: 500 });

type Outcome = { kind: "ok"; board: PublicLeaderboard } | { kind: "busy" } | { kind: "offline" } | { kind: "missing" };

interface Params {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}

// generateMetadata and the page both need the board; this makes it one request to the bot, counted once.
const load = cache(async (guildId: string, page: number): Promise<Outcome> => {
  if (!isGuildId(guildId)) return { kind: "missing" };
  const kept = boards.get(`${guildId}:${page}`);
  if (kept) return { kind: "ok", board: kept };
  const head = await headers();
  if (!limit.take(visitorKey(head.get("x-forwarded-for"), head.get("x-real-ip")))) return { kind: "busy" };
  try {
    const board = await getPublicLeaderboard(guildId, page);
    if (board) boards.set(`${guildId}:${page}`, board);
    return board ? { kind: "ok", board } : { kind: "missing" };
  } catch (error) {
    if (error instanceof ControlApiError) return { kind: "offline" };
    throw error;
  }
});

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { guildId } = await params;
  const outcome = await load(guildId, pageParam((await searchParams).page));
  const indexed = outcome.kind === "ok" && outcome.board.indexed;
  return {
    title: outcome.kind === "ok" ? `${outcome.board.server.name} leaderboard` : "Leaderboard",
    robots: { index: indexed, follow: false },
  };
}

export default async function PublicLeaderboardPage({ params, searchParams }: Params) {
  const { guildId } = await params;
  const outcome = await load(guildId, pageParam((await searchParams).page));

  if (outcome.kind === "missing") notFound();
  if (outcome.kind !== "ok") {
    return (
      <main className="lb-page">
        <div className="lb-shell">
          <p className="lb-notice" role="status">
            {outcome.kind === "busy"
              ? "Too many requests in a short time. Wait a minute, then reload the page."
              : "The leaderboard can't be shown right now. Try again in a few minutes."}
          </p>
        </div>
      </main>
    );
  }

  const { board } = outcome;
  const href = (page: number) => (page === 1 ? `/leaderboard/${guildId}` : `/leaderboard/${guildId}?page=${page}`);

  return (
    <main className="lb-page">
      <div className="lb-shell">
        <header className="lb-header">
          {board.server.icon ? (
            <img className="lb-server-icon" src={board.server.icon} alt="" width={56} height={56} />
          ) : (
            <span className="lb-server-icon lb-server-icon-blank" aria-hidden="true">
              {board.server.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div>
            <h1 className="lb-title">{board.server.name}</h1>
            <p className="lb-subtitle">Leaderboard</p>
          </div>
        </header>

        {board.members.length === 0 ? (
          <p className="lb-notice">{board.page === 1 ? "Nobody has earned experience here yet." : "There is no page that far into the leaderboard."}</p>
        ) : (
          <ol className="lb-list" start={board.members[0]?.position}>
            {board.members.map((member) => (
              <li key={member.position} className="lb-row" data-top={member.position <= 3 ? member.position : undefined}>
                <span className="lb-position">{member.position}</span>
                {member.avatar ? (
                  <img className="lb-avatar" src={member.avatar} alt="" width={36} height={36} loading="lazy" />
                ) : (
                  <span className="lb-avatar lb-avatar-blank" aria-hidden="true" />
                )}
                <span className="lb-name">{member.name}</span>
                <span className="lb-level">
                  <span className="lb-level-label">Level</span> {member.level}
                </span>
              </li>
            ))}
          </ol>
        )}

        {board.pages > 1 ? (
          <nav className="lb-pages" aria-label="Pages">
            {pageLinks(board.page, board.pages).map((page) =>
              page === board.page ? (
                <span key={page} className="lb-page-link" aria-current="page">
                  {page}
                </span>
              ) : (
                <Link key={page} className="lb-page-link" href={href(page)}>
                  {page}
                </Link>
              ),
            )}
          </nav>
        ) : null}

        <p className="lb-footnote">Members can leave themselves off this page with /leaderboard-privacy in Discord.</p>
      </div>
    </main>
  );
}
