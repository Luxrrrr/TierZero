import { requireGuildAccess } from "../../../../../lib/authz";
import { getGuildEmojis } from "../../../../../lib/control-api";
import { authzFailureResponse, proxyControlApi } from "../../../../../lib/api-helpers";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireGuildAccess(id);
  if (!access.ok) return authzFailureResponse(access);

  return proxyControlApi(() => getGuildEmojis(id));
}
