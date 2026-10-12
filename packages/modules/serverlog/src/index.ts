import { defineModule } from "@tier0/core";
import { serverLogEvents } from "./events.js";
import { serverLogSettings } from "./settings.js";

export {
  LOG_LIMITS,
  evidenceFromLogged,
  loadLogged,
  parseAttachments,
  purgeLog,
  versionsOf,
  type LoggedRow,
} from "./message-log.js";
export { purgeEntries } from "./record.js";
export type { ServerLogSettings } from "./settings.js";

export default defineModule({
  id: "serverlog",
  name: "Server logs",
  summary: "Saves what happens on the server so staff can search it from the dashboard.",
  category: "logging",
  area: "moderation",

  settings: serverLogSettings,

  events: serverLogEvents,

  // Who did something comes from the server's audit log. Without it the log still works, it just cannot say who.
  requires: ["ViewAuditLog"],
});
