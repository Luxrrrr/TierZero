import { requireGuildAccess } from "../../../../../../../../lib/authz";
import { runModuleAction } from "../../../../../../../../lib/control-api";
import { authzFailureResponse, crossOriginWriteResponse, proxyControlApi, readRequestJson } from "../../../../../../../../lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; moduleId: string; action: string }> },
) {
  const { id, moduleId, action } = await params;
  const crossOrigin = crossOriginWriteResponse(request);
  if (crossOrigin) return crossOrigin;
  const access = await requireGuildAccess(id);
  if (!access.ok) return authzFailureResponse(access);

  const read = await readRequestJson(request);
  if (!read.ok) return read.response;
  const body = (typeof read.value === "object" && read.value !== null ? read.value : {}) as { input?: unknown };
  return proxyControlApi(() => runModuleAction(id, moduleId, action, body.input, access.discordUserId));
}
