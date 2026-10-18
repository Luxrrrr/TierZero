import { s, type Infer } from "@tier0/core";
import { DAY_TIMES, END_TIMES, WEEKDAYS } from "./hours.js";
import { labelsGroup } from "./labels.js";
import { DEFAULT_CHANNEL_NAME, CHANNEL_NAME_PLACEHOLDERS, CHANNEL_NAME_SAMPLES } from "./naming.js";
import { PANEL_MAX, panelField } from "./panels.js";
import { SHORTEST_WAIT, upgradeSettings } from "./upgrade.js";
import {
  ADDED_MESSAGE,
  CLAIMED_MESSAGE,
  CLOSED_MESSAGE,
  CLOSED_SUMMARY_MESSAGE,
  CLOSED_SUMMARY_VARIABLES,
  CLOSED_VARIABLES,
  CLOSE_REQUEST_MESSAGE,
  CLOSE_REQUEST_VARIABLES,
  CLOSING_MESSAGE,
  CLOSING_VARIABLES,
  CREATED_MESSAGE,
  CREATED_VARIABLES,
  INFO_MESSAGE,
  INFO_VARIABLES,
  KEPT_OPEN_MESSAGE,
  MEMBER_VARIABLES,
  NOTE_ADDED_MESSAGE,
  OPENER_LEFT_MESSAGE,
  OPENER_LEFT_VARIABLES,
  OUTSIDE_HOURS_MESSAGE,
  OUTSIDE_HOURS_VARIABLES,
  PANEL_POSTED_LEGACY_MESSAGE,
  PANEL_POSTED_MESSAGE,
  PANEL_POSTED_VARIABLES,
  PRIORITY_MESSAGE,
  PRIORITY_VARIABLES,
  RATING_MESSAGE,
  RATING_RATED_MESSAGE,
  RATING_RATED_VARIABLES,
  RATING_THANKS_MESSAGE,
  RATING_THANKS_VARIABLES,
  RATING_VARIABLES,
  REMINDER_MESSAGE,
  REMINDER_VARIABLES,
  REMOVED_MESSAGE,
  RENAMED_MESSAGE,
  RENAMED_VARIABLES,
  REOPENED_MESSAGE,
  TICKET_VARIABLES,
  TRANSCRIPT_DM_MESSAGE,
  TRANSCRIPT_DM_VARIABLES,
  TRANSCRIPT_LINK_MESSAGE,
  TRANSCRIPT_LINK_VARIABLES,
  TRANSCRIPT_MESSAGE,
  TRANSCRIPT_VARIABLES,
  TRANSFERRED_MESSAGE,
  TRANSFERRED_VARIABLES,
  UNCLAIMED_MESSAGE,
  replyField,
} from "./messages.js";

/**
 * The tickets module's settings. `section` on each top-level setting is how
 * the dashboard splits the Settings tab; the upgrade reads a server
 * configured before panels and types existed into this shape.
 */

/** A notice posted in the ticket, which everyone in it sees. */
type MessageOptions = Parameters<typeof s.message>[0];

const notice = (
  label: string,
  help: string,
  topic: string,
  starting: MessageOptions["starting"],
  variables: MessageOptions["variables"],
  extra: Partial<MessageOptions> = {},
) => s.message({ label, help, topic, starting, variables, audience: "public", components: false, compact: true, ...extra });

/** A reply only the person who ran a command sees. */
const privately = (label: string, help: string, starting: MessageOptions["starting"], variables: MessageOptions["variables"]) =>
  s.message({
    label,
    help,
    topic: "commands",
    audience: "private",
    note: "Only the person who ran the command sees this.",
    starting,
    variables,
    delivery: "dm",
    components: false,
    compact: true,
  });

/** The headings of the Messages list, in the order a ticket meets them. */
const MESSAGE_TOPICS = [
  { id: "opens", label: "When a ticket opens" },
  { id: "open", label: "While a ticket is open" },
  { id: "closes", label: "When a ticket closes" },
  { id: "ratings", label: "Ratings and reminders" },
  { id: "commands", label: "Commands the team runs", help: "Replies to staff commands. Only the person who ran the command sees them." },
  { id: "wrong", label: "When something goes wrong", help: "Refusals and errors. Only the person who tried sees them." },
  { id: "notAllowed", label: "Not allowed", within: "wrong" },
  { id: "cannotOpen", label: "Cannot open a ticket", within: "wrong" },
  { id: "busy", label: "Cannot do that right now", within: "wrong" },
];

export const settingsSchema = s.object(
  {
    panels: s.array(panelField, {
      label: "Panels",
      help: "Messages members use to open tickets. Each panel offers one or more ticket types, and each type has its own handlers, questions and rules.",
      essential: true,
      guided: true,
      max: PANEL_MAX,
      section: "panels",
    }),
    general: s.object(
      {
        ticketLimit: s.integer({
          label: "Max open tickets of one type per member",
          help: "How many tickets of one type a member may have open at the same time, counted for each type on its own. A type can set its own.",
          default: 1,
          min: 1,
          max: 10,
        }),
        channelName: s.template({
          label: "Ticket channel name",
          help: "Capitals and spaces are turned into what Discord allows, so Ticket {username} becomes ticket-ada. A type can set its own.",
          default: DEFAULT_CHANNEL_NAME,
          placeholders: CHANNEL_NAME_PLACEHOLDERS,
          samples: CHANNEL_NAME_SAMPLES,
          preview: "channel",
          max: 90,
        }),
        adminRoles: s.array(s.role(), {
          label: "Admin roles",
          help: "See and work every type's tickets without being a handler. Members with Manage Channels count the same. Changing these settings still takes Manage Server.",
          unique: true,
        }),
        closeBehaviour: s.choice({
          label: "When a ticket closes",
          options: [
            { value: "delete", label: "Delete the channel", description: "The transcript is all that remains." },
            {
              value: "archive",
              label: "Lock and keep the channel",
              description: "It can be reopened until it is deleted, by staff or after the days below.",
            },
          ],
          default: "delete",
        }),
        closedCategory: s.channel({
          types: ["category"],
          optional: true,
          label: "Move closed tickets to",
          help: "Leave empty to keep them where they are.",
          when: { field: "closeBehaviour", equals: "archive" },
        }),
        archiveDays: s.integer({
          label: "Delete kept channels after this many days",
          help: "0 keeps them until staff delete them.",
          default: 7,
          min: 0,
          max: 365,
          when: { field: "closeBehaviour", equals: "archive" },
        }),
        reopen: s.boolean({
          label: "Closed tickets can be reopened",
          help: "Only a ticket whose channel was kept can be reopened.",
          default: true,
          when: { field: "closeBehaviour", equals: "archive" },
        }),
        closeRequestTimeout: s.duration({
          label: "Close a close request after",
          help: "How long the opener has to answer /ticket request-close before the ticket closes by itself. At least a minute.",
          default: "24h",
          max: "7d",
          min: SHORTEST_WAIT,
        }),
        claimLock: s.boolean({
          label: "A claim stops other handlers writing",
          help: "Other handlers can still read the ticket, close it, move it and change its priority and members; only sending messages is stopped. Admin roles and members with Manage Server or Manage Channels can still write. Channels only, as threads have no per-role permissions.",
          default: false,
        }),
        openerLeaves: s.choice({
          label: "When the opener leaves the server",
          options: [
            { value: "flag", label: "Say so in the ticket", description: "Posts a notice and marks the ticket in the dashboard." },
            { value: "close", label: "Close the ticket", description: "Closes it as if staff had, with the reason under Buttons and form text." },
            { value: "nothing", label: "Do nothing" },
          ],
          default: "flag",
        }),
        replies: s.object(
          {
            identity: s.choice({
              label: "Replies are sent as",
              options: [
                { value: "staff", label: "The staff member", description: "Under their own server name and picture." },
                { value: "team", label: "A team name", description: "Under one name and picture for everyone, so members see the team and not who answered." },
              ],
              default: "staff",
            }),
            teamName: s.string({
              label: "Team name",
              default: "Support Team",
              max: 80,
              when: { field: "identity", equals: "team", hide: true },
            }),
            teamAvatar: s.string({
              label: "Team picture",
              help: "A link to an image. Left empty, replies use the bot's picture.",
              url: true,
              optional: true,
              when: { field: "identity", equals: "team", hide: true },
            }),
            showStaffName: s.boolean({
              label: "Add who replied as a small line",
              help: "Adds a small line such as Replied by Kairo at the end of each reply. The dashboard shows who sent every reply either way.",
              default: false,
              when: { field: "identity", equals: "team", hide: true },
            }),
          },
          { label: "Replies from the dashboard", help: "How a reply sent from a ticket in the dashboard looks in Discord." },
        ),
        blocklist: s.object(
          {
            members: s.array(s.string({ min: 17, max: 20 }), {
              label: "Blocked members",
              help: "Discord user IDs of members who cannot open any ticket.",
              unique: true,
            }),
            roles: s.array(s.role(), { label: "Blocked roles", help: "Members with any of these cannot open any ticket.", unique: true }),
            message: replyField("blocked", "cannotOpen"),
          },
          { label: "Blocklist" },
        ),
      },
      { label: "General", section: "general" },
    ),
    transcripts: s.object(
      {
        store: s.boolean({
          label: "Keep transcripts in the dashboard",
          help: "Messages are saved as they are sent, so the transcript survives the channel. Attached files stay on Discord; only links to them are kept.",
          default: true,
        }),
        retentionDays: s.integer({
          label: "Delete saved messages after this many days",
          help: "Counted from when the ticket closed. 0 keeps them for good. The ticket and its details stay either way.",
          default: 0,
          min: 0,
          max: 3650,
          when: { field: "store", equals: true },
        }),
        logChannel: s.channel({
          types: ["text"],
          optional: true,
          guided: true,
          label: "Log channel",
          help: "Where transcript files and closed-ticket summaries are posted.",
        }),
        postFile: s.boolean({
          label: "Post the transcript file to the log channel",
          default: true,
          guided: true,
        }),
        message: s.message({
          label: "Transcript posted",
          help: "Posted in the log channel when a ticket closes.",
          topic: "closes",
          audience: "public",
          note: "The transcript itself is attached to this message as a text file.",
          starting: TRANSCRIPT_MESSAGE,
          variables: TRANSCRIPT_VARIABLES,
          components: false,
          when: { field: "postFile", equals: true },
        }),
        sendTo: s.choice({
          label: "Send the transcript to",
          help: "Sent by direct message when the ticket closes. Anyone who has direct messages closed is skipped. Handlers, observers, admins and anyone who can manage channels or the server never receive it this way.",
          options: [
            { value: "nobody", label: "Nobody" },
            { value: "opener", label: "Only the opener" },
            { value: "everyone", label: "Everyone in the ticket who is not staff", description: "The opener and the members added to the ticket." },
          ],
          default: "nobody",
        }),
        format: s.choice({
          label: "Format of the file sent",
          help: "The web page looks like the conversation did in Discord and opens in any browser. It needs Keep transcripts in the dashboard to be on; without that a text file is sent instead.",
          options: [
            { value: "html", label: "Web page" },
            { value: "text", label: "Text file" },
            { value: "both", label: "Both" },
          ],
          default: "html",
        }),
        dmMessage: s.message({
          label: "Transcript sent to members",
          help: "Sent by direct message to whoever Send the transcript to chooses. When the opener is also asked for a rating, the rating buttons are in this same message.",
          topic: "closes",
          audience: "dm",
          note: "The transcript is attached as a file.",
          starting: TRANSCRIPT_DM_MESSAGE,
          variables: TRANSCRIPT_DM_VARIABLES,
          delivery: "dm",
          components: false,
        }),
        summary: s.boolean({ label: "Post a summary of each closed ticket to the log channel", default: false }),
        summaryMessage: s.message({
          label: "Closed ticket summary",
          help: "Posted in the log channel when a ticket closes.",
          topic: "closes",
          audience: "public",
          note: "A field whose variable comes out empty is left out, and so is the View in dashboard button until the bot knows the dashboard's address.",
          starting: CLOSED_SUMMARY_MESSAGE,
          variables: CLOSED_SUMMARY_VARIABLES,
          when: { field: "summary", equals: true },
        }),
      },
      { label: "Transcripts", section: "transcripts" },
    ),
    ratings: s.object(
      {
        enabled: s.boolean({ label: "Ask the opener to rate a closed ticket", default: false }),
        message: s.message({
          label: "Rating request",
          help: "Sent to the opener by direct message after the ticket closes. When the transcript is sent to the opener too, this goes in the same message.",
          topic: "ratings",
          audience: "dm",
          note: "Sent to the opener by direct message. The 1 to 5 buttons are added under it for you.",
          starting: RATING_MESSAGE,
          variables: RATING_VARIABLES,
          delivery: "dm",
          components: false,
        }),
        commentTitle: s.string({
          label: "Title of the comment form",
          help: "Opens when a rating is picked. Discord allows 45 characters.",
          default: "Thanks for the rating",
          max: 45,
        }),
        commentQuestion: s.string({ label: "Comment question", default: "Anything you'd like to add?", max: 45 }),
        commentPlaceholder: s.string({ label: "Comment placeholder", default: "Optional", max: 100 }),
        thanks: s.message({
          label: "Thanks for rating",
          help: "Sent to the opener when they send the comment form, which opens once they pick a rating. Closing the form without sending it still keeps the rating, with no thanks.",
          topic: "ratings",
          audience: "dm",
          starting: RATING_THANKS_MESSAGE,
          variables: RATING_THANKS_VARIABLES,
          delivery: "dm",
          components: false,
        }),
        rated: s.message({
          label: "Rating DM after a rating",
          help: "Shown under the rating request in the same direct message once a rating is picked. The 1 to 5 buttons are taken off, so it can't be rated twice.",
          topic: "ratings",
          audience: "dm",
          starting: RATING_RATED_MESSAGE,
          variables: RATING_RATED_VARIABLES,
          delivery: "dm",
          components: false,
        }),
      },
      { label: "Ratings", section: "ratings" },
    ),
    automation: s.object(
      {
        autoClose: s.object(
          {
            enabled: s.boolean({ label: "Auto-close inactive tickets", default: false }),
            after: s.duration({
              label: "Close after this much inactivity",
              help: "At least a minute. A change applies to the tickets already open, counted from their last message.",
              default: "24h",
              max: "30d",
              min: SHORTEST_WAIT,
              when: { field: "enabled", equals: true },
            }),
            notice: s.boolean({
              label: "Post the closing message first",
              help: "Posts \"When a ticket is being closed\" in the ticket just before an automatic close, so it appears in the transcript. Off, an inactive ticket closes without a word.",
              default: false,
              when: { field: "enabled", equals: true },
            }),
          },
          { label: "Inactivity", help: "A ticket type can use a time of its own, or never close by itself." },
        ),
        reminder: s.object(
          {
            enabled: s.boolean({ label: "Remind the handlers", default: false }),
            after: s.duration({
              label: "When nobody has answered after",
              help: "At least a minute.",
              default: "30m",
              max: "7d",
              min: SHORTEST_WAIT,
              when: { field: "enabled", equals: true },
            }),
            message: s.message({
              label: "Reminder to staff",
              help: "Posted in the ticket when nobody has answered the opener in time.",
              topic: "ratings",
              audience: "public",
              note: "Posted in the ticket once, when only the opener has spoken by then.",
              starting: REMINDER_MESSAGE,
              variables: REMINDER_VARIABLES,
              components: false,
              when: { field: "enabled", equals: true },
            }),
          },
          { label: "Staff reminder" },
        ),
        hours: s.object(
          {
            enabled: s.boolean({ label: "Answer differently outside working hours", default: false }),
            timeZone: s.string({
              label: "Time zone",
              help: "The time zone the hours below are in, such as Europe/London, America/New_York or Asia/Tokyo. Leave empty for UTC. A name the bot does not know is read as UTC.",
              optional: true,
              max: 64,
              when: { field: "enabled", equals: true },
            }),
            days: s.array(
              s.object({
                day: s.choice({ label: "Day", options: [...WEEKDAYS], default: "mon" }),
                from: s.choice({ label: "From", options: DAY_TIMES.map((time) => ({ value: time, label: time })), default: "09:00" }),
                to: s.choice({
                  label: "Until",
                  help: "A time before the start runs past midnight into the next day.",
                  options: END_TIMES.map((time) => ({ value: time, label: time })),
                  default: "17:00",
                }),
              }),
              {
                label: "Working hours",
                help: "One row for each stretch of time the team answers. A day with no row is outside working hours. With no rows at all, every time counts as working hours.",
                max: 21,
                when: { field: "enabled", equals: true },
              },
            ),
            message: s.message({
              label: "Opened outside working hours",
              help: "Posted in a new ticket under its first message when it opens outside working hours.",
              topic: "opens",
              audience: "public",
              starting: OUTSIDE_HOURS_MESSAGE,
              variables: OUTSIDE_HOURS_VARIABLES,
              components: false,
              compact: true,
              when: { field: "enabled", equals: true },
            }),
          },
          { label: "Working hours", help: "Tickets open at any time. Outside these hours the bot tells the opener when the team is back." },
        ),
      },
      { label: "Automation", section: "automation" },
    ),
    savedReplies: s.array(
      s.object({
        name: s.string({ label: "Name", help: "What staff pick it by, in /ticket reply and in the dashboard.", default: "Thanks", min: 1, max: 100 }),
        content: s.string({
          label: "Reply",
          help: "Sent as written, under the name of whoever sends it. {user}, {staff}, {number}, {type} and {ticket} are filled in.",
          multiline: true,
          default: "Thanks {user}, we're looking into it.",
          min: 1,
          max: 2000,
        }),
      }),
      {
        label: "Saved replies",
        help: "Answers staff send often. Send one with /ticket reply in a ticket, or insert it in the dashboard's reply box.",
        max: 50,
        section: "savedReplies",
      },
    ),
    messages: s.object(
      {
        created: s.message({
          label: "Ticket opened",
          help: "Shown to the member who opened it, with a link to the ticket.",
          topic: "opens",
          audience: "private",
          starting: CREATED_MESSAGE,
          variables: CREATED_VARIABLES,
          delivery: "dm",
          components: false,
          compact: true,
        }),
        closing: notice(
          "Closing",
          "Posted in the ticket just before it closes, by the Close ticket button or /ticket close.",
          "closes",
          CLOSING_MESSAGE,
          CLOSING_VARIABLES,
        ),
        closed: notice("Closed, channel kept", "Posted in the ticket when it closes and its channel is kept.", "closes", CLOSED_MESSAGE, CLOSED_VARIABLES, {
          note: "The Reopen and Delete buttons are added under it for you.",
          attach: {
            kind: "buttons",
            buttons: [
              { name: "Reopen", label: "/labels.reopenButton", style: "/labels.reopenButtonStyle", when: "/general.reopen" },
              { name: "Delete", label: "/labels.deleteButton", style: "/labels.deleteButtonStyle" },
            ],
          },
        }),
        closeRequest: notice(
          "Asked to close",
          "Posted in the ticket by /ticket request-close, for the opener to answer.",
          "open",
          CLOSE_REQUEST_MESSAGE,
          CLOSE_REQUEST_VARIABLES,
          {
            note: "The Close and Keep open buttons are added under it for you.",
            attach: {
              kind: "buttons",
              buttons: [
                { name: "Close", label: "/labels.requestCloseButton", style: "/labels.requestCloseButtonStyle" },
                { name: "Keep open", label: "/labels.keepOpenButton", style: "/labels.keepOpenButtonStyle" },
              ],
            },
          },
        ),
        keptOpen: notice("Kept open", "Posted in the ticket when the opener answers a close request with Keep open.", "open", KEPT_OPEN_MESSAGE, TICKET_VARIABLES),
        reopened: notice("Reopened", "Posted in the ticket when a closed ticket is reopened.", "closes", REOPENED_MESSAGE, TICKET_VARIABLES),
        claimed: notice("Claimed", "Posted in the ticket when a handler claims it.", "open", CLAIMED_MESSAGE, TICKET_VARIABLES),
        unclaimed: notice("Unclaimed", "Posted in the ticket when a handler lets it go.", "open", UNCLAIMED_MESSAGE, TICKET_VARIABLES),
        priority: notice("Priority changed", "Posted in the ticket by /ticket priority.", "open", PRIORITY_MESSAGE, PRIORITY_VARIABLES),
        transferred: notice("Moved to another type", "Posted in the ticket by /ticket transfer.", "open", TRANSFERRED_MESSAGE, TRANSFERRED_VARIABLES, {
          note: "Mentions in it are real pings, so keep {handlers} in the text if the new type's handlers should be notified.",
        }),
        renamed: notice("Renamed", "Posted in the ticket by /ticket rename.", "open", RENAMED_MESSAGE, RENAMED_VARIABLES),
        added: notice("Member added", "Posted in the ticket by /ticket add.", "open", ADDED_MESSAGE, MEMBER_VARIABLES),
        removed: notice("Member removed", "Posted in the ticket by /ticket remove.", "open", REMOVED_MESSAGE, MEMBER_VARIABLES),
        openerLeft: notice(
          "Opener left",
          "Posted in an open ticket when the member who opened it leaves the server, unless General says to do nothing.",
          "open",
          OPENER_LEFT_MESSAGE,
          OPENER_LEFT_VARIABLES,
        ),
        panelPosted: privately("Panel posted", "After /ticket panel posts or updates a panel.", PANEL_POSTED_MESSAGE, PANEL_POSTED_VARIABLES),
        panelPostedLegacy: privately(
          "Panel posted, old one still up",
          "After /ticket panel first posts a panel set up before panels were tracked.",
          PANEL_POSTED_LEGACY_MESSAGE,
          PANEL_POSTED_VARIABLES,
        ),
        noteAdded: privately("Note added", "After /ticket note adds a staff note.", NOTE_ADDED_MESSAGE, TICKET_VARIABLES),
        transcriptLink: privately("Transcript link", "After /ticket transcript.", TRANSCRIPT_LINK_MESSAGE, TRANSCRIPT_LINK_VARIABLES),
        info: privately("Ticket details", "After /ticket info.", INFO_MESSAGE, INFO_VARIABLES),
        refusals: s.object(
          {
            notStaff: replyField("notStaff"),
            cannotClose: replyField("cannotClose"),
            staffOnlyClose: replyField("staffOnlyClose"),
            cannotAdd: replyField("cannotAdd"),
            notOpener: replyField("notOpener"),
            notYourClaim: replyField("notYourClaim"),
            notATicket: replyField("notATicket", "busy"),
            alreadyClosed: replyField("alreadyClosed", "busy"),
            channelMissing: replyField("channelMissing", "busy"),
            cannotRemoveOpener: replyField("cannotRemoveOpener"),
          },
          { label: "Who may do what", topic: "notAllowed" },
        ),
        opening: s.object(
          {
            categoryGone: replyField("categoryGone"),
            categoryFull: replyField("categoryFull"),
            limitOne: replyField("limitOne"),
            limitMany: replyField("limitMany"),
            cooldown: replyField("cooldown"),
            notAllowed: replyField("notAllowed"),
            typeMissing: replyField("typeMissing"),
            noCategory: replyField("noCategory"),
            createFailed: replyField("createFailed"),
          },
          { label: "Opening a ticket", topic: "cannotOpen" },
        ),
        working: s.object(
          {
            alreadyClaimed: replyField("alreadyClaimed"),
            notClaimed: replyField("notClaimed"),
            claimOff: replyField("claimOff"),
            notClosed: replyField("notClosed"),
            cannotReopen: replyField("cannotReopen"),
            reopenOff: replyField("reopenOff"),
            reopenNeedsStaff: replyField("reopenNeedsStaff", "notAllowed"),
            typeNotFound: replyField("typeNotFound"),
            sameType: replyField("sameType"),
            renameFailed: replyField("renameFailed"),
            noDashboard: replyField("noDashboard"),
            alreadyRated: replyField("alreadyRated"),
            memberMissing: replyField("memberMissing"),
            renameQueued: replyField("renameQueued"),
            noSavedReply: replyField("noSavedReply"),
          },
          { label: "Working a ticket", topic: "busy" },
        ),
        panel: s.object(
          {
            noPanelChannel: replyField("noPanelChannel"),
            panelFailed: replyField("panelFailed"),
            panelMissing: replyField("panelMissing"),
            panelEmoji: replyField("panelEmoji"),
          },
          { label: "Posting the panel", topic: "busy" },
        ),
      },
      {
        label: "What the bot says",
        help: "Every message the bot sends about tickets, in the order a ticket meets them. Edit one to reword it.",
        section: "messages",
        layout: "messages",
        topics: MESSAGE_TOPICS,
      },
    ),
    labels: labelsGroup,
  },
  { upgrade: upgradeSettings },
);

export type TicketSettings = Infer<typeof settingsSchema>;
