import { requireGuildAccess } from "../../../../../../../../../lib/authz";
import { getRowStatuses } from "../../../../../../../../../lib/control-api";
import { authzFailureResponse, proxyControlApi } from "../../../../../../../../../lib/api-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; moduleId: string; path: string }> },
) {
  const { id, moduleId, path } = await params;
  const access = await requireGuildAccess(id);
  if (!access.ok) return authzFailureResponse(access);

  return proxyControlApi(() => getRowStatuses(id, moduleId, decodeURIComponent(path)));
}
