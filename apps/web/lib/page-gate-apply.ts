import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import type { StaffRole } from "@tier0/shared-moderation";
import type { TicketAccessLevel } from "@tier0/shared-tickets";
import { PATH_HEADER } from "./login-redirect";
import { modGate, restOfPath, ticketsGate, type Gate } from "./page-gate";

/** The address this request asked for, as the proxy recorded it. */
async function requestedPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? "";
}

function apply(gate: Gate): void {
  if (gate.kind === "forbidden") forbidden();
  if (gate.kind === "redirect") redirect(gate.href);
}

/** Called by the Moderation layout once it knows who is asking. See page-gate.ts for why. */
export async function gateModPage(guildId: string, role: StaffRole | null, manager: boolean): Promise<void> {
  apply(modGate(restOfPath(await requestedPath(), guildId, "mod"), role, manager, guildId));
}

/** Called by the Tickets layout once it knows who is asking. */
export async function gateTicketsPage(guildId: string, level: TicketAccessLevel | null, canManage: boolean): Promise<void> {
  apply(ticketsGate(restOfPath(await requestedPath(), guildId, "tickets"), level, canManage));
}
