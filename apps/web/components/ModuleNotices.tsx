import Link from "next/link";
import type { ModuleNotice } from "@tier0/core";
import { getModuleNotices } from "../lib/control-api";
import { AlertIcon, InfoIcon } from "./Icons";

/**
 * The lines a module's `notices` hook gives for this server, drawn above its
 * settings form. Rendered on the server, so a save, which refreshes the page,
 * brings them up to date. A bot that does not answer just leaves them out:
 * the rest of the page says so already.
 */
export async function ModuleNotices({ guildId, moduleId }: { guildId: string; moduleId: string }) {
  let notices: ModuleNotice[];
  try {
    notices = await getModuleNotices(guildId, moduleId);
  } catch {
    return null;
  }
  if (notices.length === 0) return null;

  return (
    <div className="page-callouts">
      {notices.map((notice, index) => (
        <div key={index} className={`callout ${notice.tone === "attention" ? "callout-attention" : "callout-info"}`}>
          {notice.tone === "attention" ? <AlertIcon /> : <InfoIcon />}
          <div>
            {notice.text}
            {notice.link ? (
              <>
                {" "}
                {/^https?:\/\//.test(notice.link.href) ? (
                  <a href={notice.link.href} target="_blank" rel="noreferrer">
                    {notice.link.label}
                  </a>
                ) : (
                  <Link href={notice.link.href}>{notice.link.label}</Link>
                )}
                .
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
