import { requireGuildAccess } from "../../../../../../lib/authz";
import { updateGuildModule } from "../../../../../../lib/control-api";
import { authzFailureResponse, crossOriginWriteResponse, proxyControlApi, readRequestJson } from "../../../../../../lib/api-helpers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; moduleId: string }> },
) {
  const { id, moduleId } = await params;
  const crossOrigin = crossOriginWriteResponse(request);
  if (crossOrigin) return crossOrigin;
  const access = await requireGuildAccess(id);
  if (!access.ok) return authzFailureResponse(access);

  const patch = await readRequestJson(request);
  if (!patch.ok) return patch.response;
  return proxyControlApi(() => updateGuildModule(id, moduleId, patch.value));
}
