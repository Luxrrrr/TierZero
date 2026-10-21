import { NextResponse } from "next/server";
import { auth } from "../../../lib/auth";
import { isInstanceOwner } from "../../../lib/instance";
import { crossOriginWriteResponse, proxyControlApi } from "../../../lib/api-helpers";
import { readJsonLimited } from "../../../lib/body-limit";
import { saveBotProfile, type BotPresence } from "../../../lib/control-api";

/** A picture of up to 8 MB, written as text, is about a third larger. */
const LIMIT = 12 * 1024 * 1024;

/**
 * Owner-only: how the bot shows itself. The name and picture are the bot's on Discord, so a change reaches every
 * server it is in. Reading the page needs only a sign-in, but changing any of it is the owner's.
 */
export async function PUT(request: Request) {
  const refused = crossOriginWriteResponse(request);
  if (refused) return refused;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!(await isInstanceOwner(session.user.id))) return NextResponse.json({ error: "Only the owner of this install can do that." }, { status: 403 });

  const body = await readJsonLimited(request, LIMIT);
  if (!body.ok) return NextResponse.json({ error: body.reason === "too-large" ? "That picture is too large. Choose one under 8 MB." : "The request could not be read." }, { status: body.reason === "too-large" ? 413 : 400 });
  const { presence, name, avatar } = (typeof body.value === "object" && body.value !== null ? body.value : {}) as { presence?: BotPresence; name?: unknown; avatar?: unknown };
  if (!presence) return NextResponse.json({ error: "Say how the bot should show." }, { status: 400 });

  return proxyControlApi(() =>
    saveBotProfile({
      presence,
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof avatar === "string" || avatar === null ? { avatar } : {}),
    }),
  );
}
