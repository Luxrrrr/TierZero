import { requireGuildAccess } from "../../../../../../lib/authz";
import { updateGuildModule } from "../../../../../../lib/control-api";
import { authzFailureResponse, proxyControlApi } from "../../../../../../lib/api-helpers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; moduleId: string }> },
) {
  const { id, moduleId } = await params;
  const access = await requireGuildAccess(id);
  if (!access.ok) return authzFailureResponse(access);

  const patch = await request.json();
  return proxyControlApi(() => updateGuildModule(id, moduleId, patch));
}
