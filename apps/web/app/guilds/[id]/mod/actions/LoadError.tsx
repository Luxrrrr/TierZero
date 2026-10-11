import { AlertIcon } from "../../../../../components/Icons";

/** Shown in place of a list when the bot refused or could not answer, so the rest of the page still renders. */
export function LoadError({ what, status, message }: { what: string; status: number; message: string }) {
  const missing = status === 404;
  return (
    <div className="mod-card">
      <div className="mod-empty" data-tone="danger" role="alert">
        <span className="mod-empty-icon">
          <AlertIcon />
        </span>
        <p className="mod-empty-title">Could not load {what}</p>
        <p className="mod-empty-text">
          {missing
            ? "The bot is running a version that does not provide this yet. Update the bot and reload the page."
            : message}
        </p>
      </div>
    </div>
  );
}
