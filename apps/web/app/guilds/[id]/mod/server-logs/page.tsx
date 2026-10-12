import { forbidden, redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireStaff } from "../../../../../lib/mod-access";
import { ControlApiError } from "../../../../../lib/control-api";
import { modMessages, modServerLog, type MessageLogResult, type ServerLogResult } from "../../../../../lib/mod-api";
import { LoadError } from "../actions/LoadError";
import { messageLogApiParams, parseMessageLogQuery } from "./message-params";
import { parseServerLogQuery, parseView, serverLogApiParams } from "./params";
import { ServerLogs } from "./ServerLogs";

export const metadata: Metadata = { title: "Server logs · Moderation" };

export default async function ServerLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const raw = await searchParams;
  const view = parseView(raw);

  const access = await requireStaff(id, "messages.view");
  if (!access.ok) {
    if (access.status === 401) redirect("/login");
    forbidden();
  }
  const viewer = { discordUserId: access.discordUserId, role: access.role };

  try {
    if (view === "messages") {
      const query = parseMessageLogQuery(raw);
      const data: MessageLogResult = await modMessages(id, messageLogApiParams(query), viewer);
      return <ServerLogs guildId={id} role={access.role} view="messages" messages={{ query, data }} />;
    }
    const query = parseServerLogQuery(raw);
    const data: ServerLogResult = await modServerLog(id, serverLogApiParams(query), viewer);
    return <ServerLogs guildId={id} role={access.role} view="events" events={{ query, data }} />;
  } catch (error) {
    if (!(error instanceof ControlApiError)) throw error;
    // A moderator the owner has not opened the logs to gets an explanation instead of an error.
    if (error.status === 403) return <ServerLogs guildId={id} role={access.role} view={view} refused={error.message} />;
    return <LoadError what="the server logs" status={error.status} message={error.message} />;
  }
}
