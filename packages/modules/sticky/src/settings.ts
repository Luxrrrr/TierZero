import { embedReply, plainReply, s, type Field, type Infer, type MessageBody, type MessageVariable } from "@tier0/core";

const STICKY: MessageBody = plainReply("Please read the pinned rules before posting.");

const CHANNEL_VARIABLES: MessageVariable[] = [{ name: "channel", description: "The channel it sits in", sample: "#general" }];

const reply = (label: string, help: string, starting: MessageBody, variables: MessageVariable[] = []): Field<MessageBody> =>
  s.message({ label, help, starting, variables, delivery: "dm", components: false, compact: true, audience: "private", note: "Only the person it is shown to sees this." });

const stickyField = s.object({
  name: s.string({ label: "Name", help: "Only for you, to tell the sticky messages apart in this list.", max: 60, optional: true }),
  channel: s.channel({ label: "Channel", help: "One sticky message per channel. Picking a channel that already has one here replaces it.", types: ["text"], optional: true }),
  enabled: s.boolean({ label: "On", default: true }),
  message: s.message({
    label: "Message",
    help: "What stays at the bottom of the channel. Buttons and menus are left out, since nothing would answer them.",
    starting: STICKY,
    variables: CHANNEL_VARIABLES,
    components: false,
  }),
  pause: s.duration({
    label: "Wait for the chat to go quiet",
    help: "The sticky moves back to the bottom this long after the last message. In a channel that never goes quiet it still moves every 30 seconds.",
    default: "5s",
    min: "2s",
    max: "1h",
  }),
});

export const settingsSchema = s.object({
  stickies: s.array(stickyField, {
    label: "Sticky messages",
    help: "Each one is posted when you save, and posted again below new messages so it stays at the bottom. You can also right-click any message, choose Apps, then Stick to channel.",
    item: "sticky message",
    max: 25,
    layout: "sheet",
    card: {},
    essential: true,
  }),
  messages: s.object(
    {
      stuck: reply("Message was made sticky", "Shown after someone right-clicks a message and sticks it.", embedReply("That message now stays at the bottom of {channel}.", "success"), CHANNEL_VARIABLES),
      unstuck: reply("Sticky was removed", "Shown after someone removes the sticky message from a channel.", embedReply("{channel} no longer has a sticky message.", "success"), CHANNEL_VARIABLES),
      nothing: reply("Nothing to remove", "Shown when someone removes a sticky message from a channel that has none.", embedReply("{channel} doesn't have a sticky message.", "info"), CHANNEL_VARIABLES),
      notAllowed: reply("Not allowed", "Shown to someone without Manage Messages in the channel.", embedReply("You need the Manage Messages permission in {channel} to do that.", "error"), CHANNEL_VARIABLES),
      failed: reply("Could not post it", "Shown when the bot cannot send in the channel.", embedReply("I couldn't post in {channel}. Check that I can view it and send messages there.", "error"), CHANNEL_VARIABLES),
      empty: reply("Nothing to copy", "Shown when the message someone picked has no text or embeds to copy.", embedReply("That message has no text or embeds I can keep at the bottom.", "error")),
    },
    { label: "Replies", help: "What the bot says back to the person using the right-click menu.", collapsible: true },
  ),
});

export type StickySettings = Infer<typeof settingsSchema>;
export type Sticky = StickySettings["stickies"][number];
