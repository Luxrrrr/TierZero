import { s, SERVER_LOG_CATEGORIES } from "@tier0/core";
import type { Infer } from "@tier0/core";

const category = (id: (typeof SERVER_LOG_CATEGORIES)[number]["id"]) => {
  const found = SERVER_LOG_CATEGORIES.find((c) => c.id === id)!;
  return s.boolean({ default: true, label: found.label, help: found.description });
};

export const serverLogSettings = s.object({
  categories: s.object(
    {
      members: category("members"),
      messages: s.boolean({
        default: true,
        label: "Messages",
        help: "Saves member messages, their edits and whether they were deleted, so staff can search them and attach them to a warning. Bot messages are skipped. The text is stored on this machine.",
      }),
      moderation: category("moderation"),
      roles: category("roles"),
      channels: category("channels"),
      voice: category("voice"),
      server: category("server"),
    },
    { label: "What to record", help: "Turn off any kind you don't want. New entries stop, and the ones already saved stay." },
  ),
  days: s.integer({
    min: 1,
    max: 365,
    default: 30,
    label: "Days to keep the log",
    help: "Older entries and messages are deleted automatically.",
  }),
  exclude: s.array(s.channel({ types: ["text", "voice"] }), {
    label: "Channels to leave out",
    help: "Nothing that happens in these channels is saved. Good for private staff channels.",
  }),
  modsCanView: s.boolean({
    default: false,
    label: "Let moderators open the server logs",
    help: "Admins and the owner always can. Anyone only sees channels they can read in Discord.",
  }),
});

export type ServerLogSettings = Infer<typeof serverLogSettings>;
