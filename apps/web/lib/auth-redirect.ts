import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PATH_HEADER, loginHref } from "./login-redirect";
import { isInstanceClaimed } from "./instance";

/** The sign-in page, carrying the page this request asked for. Server components only. */
export async function loginPath(): Promise<string> {
  const requested = (await headers()).get(PATH_HEADER);
  return loginHref(requested);
}

/** Sends a signed-out visitor to sign in, and back here afterwards. */
export async function redirectToLogin(): Promise<never> {
  redirect(await loginPath());
}

/**
 * An install nobody has claimed yet goes to the first-run screen from any
 * signed-in page, so the operator who signs in first is the one asked to claim
 * it, rather than whoever next opens the home page.
 */
export async function redirectIfUnclaimed(): Promise<void> {
  if (!(await isInstanceClaimed())) redirect("/setup");
}
