import type { BotProfile } from "../lib/control-api";
import { BotProfileForm } from "./BotProfileForm";

/**
 * The body of the Bot profile page: how the bot shows itself on Discord. It is about the whole install, so the page
 * around it differs, since one sits inside a server's navigation and one does not, but this is the same either way.
 */
export function BotProfileContent({ profile, owner }: { profile: BotProfile | null; owner: boolean }) {
  return (
    <>
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-eyebrow">Bot profile</p>
          <h1 className="page-title">The bot's name, picture and status</h1>
          <p className="page-summary">How the bot shows in every server it is in. A change here reaches all of them.</p>
        </div>
      </div>
      {profile ? <BotProfileForm profile={profile} owner={owner} /> : <p className="field-help">The dashboard could not reach the bot, so its profile can't be shown right now.</p>}
    </>
  );
}
