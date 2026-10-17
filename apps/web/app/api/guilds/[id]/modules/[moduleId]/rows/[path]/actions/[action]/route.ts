import { requireGuildAccess } from "../../../../../../../../../../lib/authz";
import { runRowAction } from "../../../../../../../../../../lib/control-api";
import { authzFailureResponse, crossOriginWriteResponse, proxyControlApi } from "../../../../../../../../../../lib/api-helpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; moduleId: string; path: string; action: string }> },
) {
  const { id, moduleId, path, action } = await params;
  const crossOrigin = crossOriginWriteResponse(request);
  if (crossOrigin) return crossOrigin;
  const access = await requireGuildAccess(id);
  if (!access.ok) return authzFailureResponse(access);

  const body = (await request.json().catch(() => ({}))) as { input?: unknown };
  return proxyControlApi(() => runRowAction(id, moduleId, decodeURIComponent(path), action, body.input));
}
