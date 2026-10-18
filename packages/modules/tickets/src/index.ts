import { defineModule } from "@tier0/core";
import { ticketCommand } from "./command.js";
import { DIRECT_MESSAGE_ACTIONS, components, modals } from "./interactions.js";
import { events, reconcileSchedules, scheduleSweep, tasks } from "./runtime.js";
import { settingsSchema } from "./settings.js";

export default defineModule({
  id: "tickets",
  name: "Tickets",
  summary: "Panels members use to open a private channel or thread with the right staff.",
  category: "support",
  area: "tickets",
  requires: ["ManageChannels"],

  settings: settingsSchema,
  commands: [ticketCommand],
  components,
  modals,
  directMessage: DIRECT_MESSAGE_ACTIONS,
  events,
  tasks,

  async onEnable(ctx) {
    await scheduleSweep(ctx);
  },

  async onSettingsChange(ctx, previous) {
    const before = previous.transcripts;
    const after = ctx.settings.transcripts;
    if (before.store !== after.store || before.retentionDays !== after.retentionDays) await scheduleSweep(ctx);
    await reconcileSchedules(ctx, previous);
  },
});

export {
  addTicketNote,
  changeTicketMember,
  claimTicket,
  closeTicketAs,
  getTicketDetail,
  panelStatuses,
  postPanel,
  renameTicket,
  reopenTicket,
  replyToTicket,
  requestTicketClose,
  setTicketPriority,
  ticketHealthFacts,
  transferTicket,
  unclaimTicket,
} from "./actions.js";
export { priorityLabel } from "./labels.js";
export { ticketNumber, transcriptRemovalOf } from "./records.js";
export type { TicketActionOptions, TicketCtx } from "./actions.js";
export { TicketActionError } from "./outcome.js";
export { forgetOpenTickets } from "./cache.js";
export {
  acquireWait,
  heldWaits,
  inboxVersion,
  notifyTicket,
  pendingWaits,
  ticketDetailVersion,
  ticketVersion,
  waitForInbox,
  waitForTicket,
  WAITS_PER_GUILD,
  WAITS_PER_VIEWER,
  type TicketChangeKind,
} from "./live.js";
export { messageDto } from "./detail.js";
export { accessSettingsOf, allTypes, findPanel, findType, staffRolesOf, typeOfTicket } from "./resolve.js";
export { transcriptTexts } from "./labels.js";
export { plainMentions } from "./transcript-html.js";
export { renderStoredTranscriptText, renderTranscriptHtml } from "./transcript-html.js";
export type { StoredTranscriptMessage, StoredTranscriptTicket } from "./transcript-html.js";
export type { TicketSettings } from "./settings.js";
export type { TicketPanel, TicketType } from "./panels.js";
export { openTicketAs, type StaffTicketRequest } from "./staff-open.js";
