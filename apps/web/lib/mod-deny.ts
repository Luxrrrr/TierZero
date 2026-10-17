import { forbidden, redirect } from "next/navigation";
import { guildAccess } from "./guild-access";

/**
 * What a staff-only Moderation page does for someone it turns away. Signed
 * out goes to sign-in. Someone who manages the server without being on its
 * staff list can use the Settings tab and nothing else here, so a bookmark or
 * a shared link takes them there instead of to a refusal that explains a
 * permission they already hold. Everyone else gets the usual refusal.
 */
export async function denyStaffPage(guildId: string, status: number): Promise<never> {
  if (status === 401) redirect("/login");
  const access = await guildAccess(guildId).catch(() => null);
  if (access?.ok && access.manager && !access.staffRole) redirect(`/guilds/${guildId}/mod/settings`);
  forbidden();
}
