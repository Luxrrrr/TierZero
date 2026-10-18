import type {
  MessageEmbed,
  ModuleContext,
  TicketActionResult,
  TicketActor,
  TicketCreateResult,
  TicketHealthFacts,
  TicketPanelPostResult,
  TicketPanelStatusDto,
  TicketPriority,
  TicketReplyFile,
  TicketReplyResult,
} from "@tier0/core";
import {
  acquireWait,
  accessSettingsOf,
  addTicketNote,
  allTypes,
  changeTicketMember,
  claimTicket,
  closeTicketAs,
  openTicketAs,
  inboxVersion,
  panelStatuses,
  postPanel,
  priorityLabel,
  renameTicket,
  reopenTicket,
  renderStoredTranscriptText,
  renderTranscriptHtml,
  replyToTicket,
  requestTicketClose,
  setTicketPriority,
  staffRolesOf,
  ticketDetailVersion,
  ticketHealthFacts,
  ticketNumber,
  ticketVersion,
  transcriptRemovalOf,
  transcriptTexts,
  transferTicket,
  typeOfTicket,
  unclaimTicket,
  waitForInbox,
  waitForTicket,
  type StaffTicketRequest,
  type TicketSettings,
} from "@tier0/module-tickets";

/**
 * Everything the control API takes from the tickets module, in one place. The
 * work behind each dashboard write is the module's, the same code the slash
 * commands run, and the routes reach it through this object so a test can put
 * fakes in its place without a gateway connection.
 */

export type { TicketSettings };
export type TicketCtx = ModuleContext<TicketSettings>;

export interface TicketServices {
  claimTicket(ctx: TicketCtx, ticketId: number, actor: TicketActor): Promise<TicketActionResult>;
  unclaimTicket(ctx: TicketCtx, ticketId: number, actor: TicketActor): Promise<TicketActionResult>;
  setTicketPriority(ctx: TicketCtx, ticketId: number, priority: TicketPriority, actor: TicketActor): Promise<TicketActionResult>;
  addTicketNote(ctx: TicketCtx, ticketId: number, body: string, actor: TicketActor): Promise<TicketActionResult>;
  changeTicketMember(
    ctx: TicketCtx,
    ticketId: number,
    change: { userId: string; action: "add" | "remove"; name?: string },
    actor: TicketActor,
  ): Promise<TicketActionResult>;
  transferTicket(ctx: TicketCtx, ticketId: number, target: { typeId: string }, actor: TicketActor): Promise<TicketActionResult>;
  closeTicketAs(ctx: TicketCtx, ticketId: number, close: { reason?: string }, actor: TicketActor): Promise<TicketActionResult>;
  reopenTicket(ctx: TicketCtx, ticketId: number, actor: TicketActor): Promise<TicketActionResult>;
  replyToTicket(
    ctx: TicketCtx,
    ticketId: number,
    content: string,
    actor: TicketActor,
    files?: readonly TicketReplyFile[],
    embeds?: readonly MessageEmbed[],
    replyToMessageId?: string,
  ): Promise<TicketReplyResult>;
  renameTicket(ctx: TicketCtx, ticketId: number, name: string, actor: TicketActor): Promise<TicketActionResult>;
  requestTicketClose(ctx: TicketCtx, ticketId: number, request: { reason: string | null }, actor: TicketActor): Promise<TicketActionResult>;
  postPanel(ctx: TicketCtx, panelId: string, actor: TicketActor): Promise<TicketPanelPostResult>;
  openTicketAs(ctx: TicketCtx, request: StaffTicketRequest, actor: TicketActor): Promise<TicketCreateResult>;
  panelStatuses(ctx: TicketCtx, options?: { fresh?: boolean }): Promise<TicketPanelStatusDto[]>;
  ticketHealthFacts(ctx: TicketCtx): Promise<TicketHealthFacts>;
}

export const moduleServices: TicketServices = {
  claimTicket,
  unclaimTicket,
  setTicketPriority,
  addTicketNote,
  changeTicketMember,
  transferTicket,
  closeTicketAs,
  reopenTicket,
  replyToTicket,
  renameTicket,
  requestTicketClose,
  postPanel,
  openTicketAs,
  panelStatuses,
  ticketHealthFacts,
};

export {
  acquireWait,
  accessSettingsOf,
  allTypes,
  inboxVersion,
  priorityLabel,
  renderStoredTranscriptText,
  renderTranscriptHtml,
  staffRolesOf,
  ticketDetailVersion,
  ticketNumber,
  ticketVersion,
  transcriptRemovalOf,
  transcriptTexts,
  typeOfTicket,
  waitForInbox,
  waitForTicket,
};
