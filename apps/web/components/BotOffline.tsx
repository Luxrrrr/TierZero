"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertIcon } from "./Icons";

const RETRY_SECONDS = 10;

interface Props {
  /** A page that already has its own heading passes false, so there is only one. */
  ownHeading?: boolean;
}

/**
 * Shown in place of a page's content when the dashboard cannot reach the bot.
 * The bot owns every setting, so there is nothing useful to show without it.
 * It checks again by itself, so a bot that is being restarted brings the page
 * back without anyone pressing anything.
 */
export function BotOffline({ ownHeading = true }: Props) {
  const router = useRouter();
  const [left, setLeft] = useState(RETRY_SECONDS);
  const [checking, startChecking] = useTransition();

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLeft((current) => {
        if (current > 1) return current - 1;
        startChecking(() => router.refresh());
        return RETRY_SECONDS;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [router]);

  const Heading = ownHeading ? "h1" : "h2";

  return (
    <div className="empty bot-offline">
      <AlertIcon className="empty-icon" />
      <Heading className="empty-title">TierZero&apos;s bot is not running</Heading>
      <p className="empty-text">
        The dashboard is up, but the bot it works with is not answering, so
        nothing can be shown or changed right now. Your settings are safe. Whoever
        runs this install can start the bot again, for example by restarting it
        in Docker.
      </p>
      <p className="empty-text bot-offline-retry">
        {checking ? "Checking…" : `Checking again in ${left} ${left === 1 ? "second" : "seconds"}.`}
      </p>
      <div className="empty-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={checking}
          onClick={() => {
            setLeft(RETRY_SECONDS);
            startChecking(() => router.refresh());
          }}
        >
          Try again now
        </button>
      </div>
    </div>
  );
}
