import { s, type Field, type Infer, type ModuleContext } from "@tier0/core";
import { isWebAddress, normalizeFeedAddress, steamAppIdOf } from "./address.js";
import { labelsGroup, replyField } from "./labels.js";
import { NEWS_MESSAGE, NEWS_VARIABLES, STEAM_MESSAGE, STEAM_VARIABLES } from "./messages.js";

/** A field that also refuses a parsed value the test rejects, with the message given. */
function checked<T>(field: Field<T>, test: (value: T) => boolean, message: string): Field<T> {
  return {
    ...field,
    parse(input, path = "") {
      const result = field.parse(input, path);
      if (result.ok && result.value !== undefined && !test(result.value)) return { ok: false, errors: [{ path, message }] };
      return result;
    },
  };
}

/**
 * Pasted addresses are tidied before they are checked, so "example.com/feed" is
 * read as https. One that still is not a web address is cleared rather than
 * refused, since the same check runs when saved settings are read, and one bad
 * row saved before addresses were checked would otherwise stop every feed. The
 * row then says it has no address.
 */
function upgradeFeed(stored: Record<string, unknown>): Record<string, unknown> {
  if (typeof stored.url !== "string") return stored;
  const url = normalizeFeedAddress(stored.url);
  if (isWebAddress(url)) return { ...stored, url };
  const { url: _bad, ...rest } = stored;
  return rest;
}

/**
 * The app ID used to be a number. It is text now so a store link can be
 * pasted, and is kept as the bare number either way.
 */
function upgradeGame(stored: Record<string, unknown>): Record<string, unknown> {
  const id = steamAppIdOf(stored.appId);
  return id === null ? stored : { ...stored, appId: id };
}

const ownPost = (starting: typeof NEWS_MESSAGE, variables: typeof NEWS_VARIABLES, what: string) => ({
  custom: s.boolean({ label: "Use a post of its own", help: `Off, it uses the post set for every ${what} above.`, default: false }),
  message: s.message({
    label: "Its own post",
    starting,
    variables,
    when: { field: "custom", equals: true },
  }),
});

export const settingsSchema = s.object({
  pollEvery: s.duration({
    label: "Check for new posts every",
    help: "At least 5 minutes, to avoid hammering the sites it reads.",
    default: "15m",
    min: "5m",
    max: "1d",
  }),
  news: s.object(
    {
      enabled: s.boolean({ label: "Post new items from news feeds", default: true }),
      message: s.message({
        label: "Post",
        help: "How each new item is posted. A feed can have a post of its own instead.",
        starting: NEWS_MESSAGE,
        variables: NEWS_VARIABLES,
      }),
      feeds: s.array(
        s.object(
          {
            name: s.string({
              label: "Name",
              help: "Shown above each post. The feed's own title is used when this is empty.",
              optional: true,
              max: 80,
            }),
            url: s.string({
              label: "Feed address",
              help: "An RSS or Atom link, a site that links to its feed, or a YouTube channel or playlist page. For a subreddit, add .rss to its address.",
              max: 500,
              optional: true,
              url: true,
            }),
            channel: s.channel({ types: ["text"], label: "Post in" }),
            mention: s.role({ label: "Ping a role", optional: true }),
            ...ownPost(NEWS_MESSAGE, NEWS_VARIABLES, "feed"),
          },
          { upgrade: upgradeFeed },
        ),
        {
          label: "Feeds",
          help: "The newest item is posted when a feed is first added; after that, only items that appear later. The same feed can post to more than one channel.",
          max: 25,
          item: "feed",
          essential: "source",
        },
      ),
    },
    { label: "News feeds" },
  ),
  patchNotes: s.object(
    {
      enabled: s.boolean({ label: "Post Steam patch notes", default: true }),
      message: s.message({
        label: "Post",
        help: "How each patch note is posted. A channel can have a post of its own instead.",
        starting: STEAM_MESSAGE,
        variables: STEAM_VARIABLES,
      }),
      destinations: s.array(
        s.object({
          channel: s.channel({ types: ["text"], label: "Post in" }),
          mention: s.role({ label: "Ping a role", optional: true }),
          games: s.array(
            s.object(
              {
                appId: checked(
                  s.string({
                    label: "Steam app ID or store link",
                    help: "Paste the game's store address, or the number in it: store.steampowered.com/app/1091500/",
                    max: 300,
                  }),
                  (value) => /^\d{1,10}$/.test(value),
                  "must be a Steam store link or the app ID number in it",
                ),
                name: s.string({ label: "Game", help: "Shown on each post.", max: 60 }),
                scope: s.choice({
                  label: "What to post",
                  options: [
                    { value: "patch", label: "Patch notes and update announcements only" },
                    { value: "all", label: "Every announcement the developer makes" },
                  ],
                  default: "patch",
                }),
              },
              { upgrade: upgradeGame },
            ),
            { label: "Games", item: "game", max: 25 },
          ),
          ...ownPost(STEAM_MESSAGE, STEAM_VARIABLES, "game"),
        }),
        {
          label: "Patch notes channels",
          item: "channel",
          help: "Each channel gets the patch notes for its own games. A game can be listed under more than one channel.",
          max: 10,
          essential: "source",
        },
      ),
    },
    { label: "Steam patch notes" },
  ),
  replies: s.object(
    {
      statusEmpty: replyField("statusEmpty"),
      status: replyField("status"),
      noMatch: replyField("noMatch"),
      ambiguous: replyField("ambiguous"),
    },
    {
      label: "Replies and errors",
      help: "What /feeds status and /feeds send say. The reply to a successful send is edited from the Commands page.",
      collapsible: true,
    },
  ),
  labels: labelsGroup,
});

export type FeedsSettings = Infer<typeof settingsSchema>;
export type FeedsContext = ModuleContext<FeedsSettings>;
