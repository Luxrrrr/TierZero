import { s, type Infer, type ModuleContext } from "@tier0/core";

export const settingsSchema = s.object({
  pollEvery: s.duration({
    label: "Check for new posts every",
    help: "Shorter than 5 minutes is treated as 5, which keeps the bot polite to the sites it reads.",
    default: "15m",
    max: "1d",
  }),
  news: s.object(
    {
      enabled: s.boolean({ label: "Post new items from news feeds", default: true }),
      feeds: s.array(
        s.object({
          name: s.string({
            label: "Name",
            help: "Shown above each post. The feed's own title is used when this is empty.",
            optional: true,
            max: 80,
          }),
          url: s.string({
            label: "Feed address",
            help: "An RSS or Atom link. Most sites, subreddits (add .rss to the address) and YouTube channels have one.",
            max: 500,
          }),
          channel: s.channel({ types: ["text"], label: "Post in" }),
          mention: s.role({ label: "Ping a role", optional: true }),
        }),
        {
          label: "Feeds",
          help: "The newest item is posted when a feed is first added; after that, only items that appear later.",
          max: 25,
        },
      ),
    },
    { label: "News feeds" },
  ),
  patchNotes: s.object(
    {
      enabled: s.boolean({ label: "Post Steam patch notes", default: true }),
      destinations: s.array(
        s.object({
          channel: s.channel({ types: ["text"], label: "Post in" }),
          mention: s.role({ label: "Ping a role", optional: true }),
          games: s.array(
            s.object({
              appId: s.integer({
                label: "Steam app ID",
                help: "The number in the game's store address: store.steampowered.com/app/1091500/",
                min: 1,
              }),
              name: s.string({ label: "Game", help: "Shown on each post.", max: 60 }),
              scope: s.choice({
                label: "What to post",
                options: [
                  { value: "patch", label: "Patch notes and update announcements only" },
                  { value: "all", label: "Every announcement the developer makes" },
                ],
                default: "patch",
              }),
            }),
            { label: "Games posted here", max: 25 },
          ),
        }),
        {
          label: "Channels",
          help: "Each channel gets the patch notes for its own games. A game can be listed under more than one channel.",
          max: 10,
        },
      ),
    },
    { label: "Steam patch notes" },
  ),
});

export type FeedsSettings = Infer<typeof settingsSchema>;
export type FeedsContext = ModuleContext<FeedsSettings>;
