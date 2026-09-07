import { requireGuildAccess } from "../../../../../../lib/authz";
import { updateGuildCommand } from "../../../../../../lib/control-api";
import { authzFailureResponse, proxyControlApi } from "../../../../../../lib/api-helpers";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const access = await requireGuildAccess(id);
  if (!access.ok) return authzFailureResponse(access);

  const patch = await request.json();
  return proxyControlApi(() => updateGuildCommand(id, name, patch));
}
