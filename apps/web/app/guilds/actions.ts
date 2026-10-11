"use server";

import { signOut } from "../../lib/auth";

/** Shared by the server list and the per-guild shell, which both render the sidebar. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
