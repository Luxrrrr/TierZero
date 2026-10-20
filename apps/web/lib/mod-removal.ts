import type { LiftResult } from "@tier0/shared-moderation";

/**
 * The toast after removing a case from the record. A ban or timeout that was
 * still in force is lifted in Discord on a best effort basis, so the wording
 * follows what the bot says happened rather than what was asked for.
 */

function readLift(raw: unknown): { kind: "ban" | "timeout"; result: LiftResult } | null {
  if (raw === null || typeof raw !== "object") return null;
  const lift = (raw as { lift?: unknown }).lift;
  if (lift === null || typeof lift !== "object") return null;
  const { kind, result } = lift as { kind?: unknown; result?: unknown };
  if (kind !== "ban" && kind !== "timeout") return null;
  if (result !== "lifted" && result !== "kept" && result !== "failed" && result !== "nothing") return null;
  return { kind, result };
}

export function removalToast(label: string, reply: unknown): { title: string; detail?: string } {
  const title = `Removed ${label} from the record.`;
  const lift = readLift(reply);
  if (!lift) return { title };
  const what = lift.kind === "ban" ? "ban" : "timeout";
  switch (lift.result) {
    case "lifted":
      return { title: `Removed ${label} from the record and lifted the ${what}.` };
    case "kept":
      return { title, detail: `The ${what} in Discord stays because another ${what} case on them is still in force.` };
    case "failed":
      return {
        title,
        detail:
          lift.kind === "ban"
            ? "The ban in Discord could not be lifted, so it is still in place. Check that the bot can ban members, then unban them from their record."
            : "The timeout in Discord could not be lifted, so it is still in place. Check that the bot's role is above theirs.",
      };
    default:
      return { title, detail: lift.kind === "ban" ? "They were not banned in Discord any more, so there was nothing to lift." : "There was no timeout left in Discord to lift." };
  }
}
