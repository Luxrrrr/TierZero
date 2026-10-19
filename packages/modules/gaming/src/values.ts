import type { ReplyValues } from "@tier0/core";
import { partyLines, partyOf } from "./party.js";
import { discordTime } from "./time.js";
import { entryLine, listLines, type ListedEntry } from "./signup-logic.js";

/**
 * The values the posts are filled from. Free of discord.js so they can be
 * tested on their own.
 */

export interface PostFacts {
  gameName: string;
  authorId: string;
  authorName: string;
  needed: number;
  note: string;
  startsAt: Date | null;
  expiresAt: Date;
  members: { userId: string }[];
}

export interface GameFacts {
  emoji?: string | undefined;
  role?: string | undefined;
}

export function lfgValues(post: PostFacts, game: GameFacts | undefined, voiceChannelId: string | null): ReplyValues {
  const party = partyOf(post.needed, post.members.length);
  return {
    game: post.gameName,
    emoji: game?.emoji ?? "",
    author: `<@${post.authorId}>`,
    authorName: post.authorName,
    needed: post.needed,
    open: party.open,
    filled: party.filled,
    capacity: party.capacity,
    party: partyLines(
      post.authorId,
      post.members.map((member) => member.userId),
    ),
    note: post.note,
    starts: post.startsAt ? discordTime(post.startsAt, "F") : "",
    expires: discordTime(post.expiresAt, "R"),
    ping: game?.role ? `<@&${game.role}>` : "",
    voice: voiceChannelId ? `<#${voiceChannelId}>` : "",
  };
}

export interface SignupFacts {
  id: number;
  title: string;
  game: string;
  note: string;
  startsAt: Date | null;
  teamSize: number;
  capacity: number;
}

export function signupValues(event: SignupFacts, registered: ListedEntry[], waiting: ListedEntry[]): ReplyValues {
  const places = event.capacity > 0 ? `${registered.length}/${event.capacity}` : String(registered.length);
  return {
    title: event.title,
    id: event.id,
    game: event.game,
    note: event.note,
    starts: event.startsAt ? discordTime(event.startsAt, "F") : "",
    teamSize: event.teamSize,
    places,
    registered: listLines(
      registered.map((entry) => entryLine(entry, event.teamSize)),
      1000,
    ),
    waiting: listLines(
      waiting.map((entry, index) => `${index + 1}. ${entryLine(entry, event.teamSize)}`),
      1000,
    ),
    count: registered.length,
    capacity: event.capacity > 0 ? event.capacity : "",
    waitingCount: waiting.length,
  };
}
