import { embedReply, s, type Field, type MessageBody, type MessageVariable } from "@tier0/core";
import { DEFAULT_FAILURES } from "./failures.js";

/**
 * The text the commands and status lines are written in. Defaults are the
 * wording the module has always used. Free of discord.js so they can be tested
 * on their own.
 */

export const STATUS_EMPTY = embedReply("Nothing is being watched yet. Add a feed or a game in the dashboard.", "info");
export const STATUS_REPLY = embedReply("{lines}", "info");
export const NO_MATCH = embedReply('Nothing being watched matches "{query}". /feeds status lists everything.', "error");
export const AMBIGUOUS = embedReply('"{query}" matches more than one source. Use a more specific name:\n{sources}', "error");

const QUERY: MessageVariable = { name: "query", description: "What was typed after /feeds send", sample: "gazette" };

export const REPLIES = {
  statusEmpty: {
    label: "Nothing is being watched",
    help: "Shown for /feeds status when no feed or game has been added, or both kinds are switched off.",
    starting: STATUS_EMPTY,
    variables: [] as MessageVariable[],
  },
  status: {
    label: "What /feeds status shows",
    help: "Wraps the list of sources. How each line reads is set under Labels and text.",
    starting: STATUS_REPLY,
    variables: [
      { name: "lines", description: "One line for each source, saying when it was last checked", sample: "Example Gazette: checked 5 minutes ago, working" },
      { name: "count", description: "How many sources are being watched", sample: "2" },
    ] as MessageVariable[],
  },
  noMatch: {
    label: "No source matches",
    help: "Shown for /feeds send when what was typed matches no feed or game.",
    starting: NO_MATCH,
    variables: [QUERY],
  },
  ambiguous: {
    label: "More than one source matches",
    help: "Shown for /feeds send when what was typed matches several sources.",
    starting: AMBIGUOUS,
    variables: [QUERY, { name: "sources", description: "The names of the sources that matched, one to a line", sample: "Example Gazette\nExample Daily" }],
  },
};

export type ReplyKey = keyof typeof REPLIES;

export const replyField = (key: ReplyKey): Field<MessageBody> =>
  s.message({
    label: REPLIES[key].label,
    help: REPLIES[key].help,
    note: "Only the person who ran the command sees this.",
    audience: "private",
    starting: REPLIES[key].starting,
    variables: REPLIES[key].variables,
    delivery: "dm",
    components: false,
    compact: true,
  });

export const DEFAULT_LABELS = {
  statusNever: "{source}: not checked yet",
  statusWorking: "{source}: checked {checked}, working",
  statusProblem: "{source}: checked {checked}, problem: {problem}",
  stopped: "Stopped because: {error}.",
} as const;

const D = DEFAULT_FAILURES;
const problem = (label: string, key: keyof typeof D, placeholders: string[] = []): Field<string> =>
  placeholders.length > 0
    ? s.template({ label, default: D[key], placeholders, max: 300 })
    : s.string({ label, default: D[key], max: 300 });

export const labelsGroup = s.object(
  {
    statusNever: s.template({
      label: "Status line: not checked yet",
      default: DEFAULT_LABELS.statusNever,
      placeholders: ["source"],
      max: 300,
    }),
    statusWorking: s.template({
      label: "Status line: working",
      default: DEFAULT_LABELS.statusWorking,
      placeholders: ["source", "checked"],
      max: 300,
    }),
    statusProblem: s.template({
      label: "Status line: problem",
      help: "{checked} is shown as how long ago, in each reader's own time.",
      default: DEFAULT_LABELS.statusProblem,
      placeholders: ["source", "checked", "problem"],
      max: 300,
    }),
    stopped: s.template({
      label: "Sentence for a send that stopped early",
      help: "Fills {problem} in the reply to /feeds send, and is left empty when everything was sent.",
      default: DEFAULT_LABELS.stopped,
      placeholders: ["error"],
      max: 300,
    }),
    problems: s.object(
      {
        tooManyRedirects: problem("Too many redirects", "tooManyRedirects"),
        invalidAddress: problem("Not a valid address", "invalidAddress"),
        unsupportedScheme: problem("Not an http or https address", "unsupportedScheme"),
        notPublic: problem("Address is not on the public internet", "notPublic"),
        tooLarge: problem("Response too large", "tooLarge"),
        timeout: problem("Server too slow", "timeout"),
        rateLimited: problem("Site is limiting requests (status 429)", "rateLimited"),
        siteStatus: problem("Site answered with another status", "siteStatus", ["status"]),
        steamStatus: problem("Steam answered with another status", "steamStatus", ["status"]),
        steamNotJson: problem("Steam did not answer with data", "steamNotJson"),
        steamUnexpected: problem("Steam answered with something unexpected", "steamUnexpected"),
        notReadable: problem("Address returned something unreadable", "notReadable"),
        notAFeed: problem("Address is not an RSS or Atom feed", "notAFeed"),
        channelGone: problem("Channel deleted", "channelGone"),
        postFailed: problem("Post could not be sent", "postFailed"),
        notFound: problem("Address could not be found", "notFound"),
        refused: problem("Site refused the connection", "refused"),
        connectionLost: problem("Connection was cut off", "connectionLost"),
        badCertificate: problem("Site's certificate is not valid", "badCertificate"),
        unknown: problem("Anything else", "unknown"),
      },
      {
        label: "Problem descriptions",
        help: "Written after \"problem:\" in /feeds status and beside a feed on the dashboard when it could not be read or posted. They are recorded at the next check.",
      },
    ),
  },
  {
    label: "Labels and text",
    help: "The status lines, the sentence for a send that stopped early and the reasons a source can fail.",
    collapsible: true,
  },
);
