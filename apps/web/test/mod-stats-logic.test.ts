import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  actionBars,
  automodLogHref,
  automodView,
  changeBetween,
  actionVerb,
  changeSentence,
  fullDate,
  hourRange,
  repeatPercent,
  chartSummary,
  indexFromPosition,
  longerRange,
  metricValue,
  mixSummary,
  moderatorLogHref,
  moderatorMix,
  periodText,
  presentSeries,
  seriesOf,
  seriesTotals,
  sparkPaths,
  sparkValues,
  stepIndex,
  toggled,
  tooltipSentence,
  visibleTotal,
  formatPercent,
  gridValues,
  hourCells,
  labelIndexes,
  niceMax,
  parseRange,
  peakHourText,
  repeatRateText,
  segmentsFor,
  shortDate,
  sharePercent,
  bucketOf,
  dayMs,
  longDate,
  monthLabel,
  parseRangeSpec,
  pointLabel,
  pointTitle,
  rangeHref,
  rangeParams,
  rangePhrase,
  rangeWasRejected,
  rangeQuery,
  statsExportHref,
} from "../app/guilds/[id]/mod/stats-logic.ts";

const day = (date: string, warn = 0, timeout = 0, kick = 0, ban = 0, other = 0) => ({
  date,
  warn,
  timeout,
  kick,
  ban,
  other,
});

describe("parseRange", () => {
  test("accepts the three offered ranges", () => {
    assert.equal(parseRange("7"), 7);
    assert.equal(parseRange("30"), 30);
    assert.equal(parseRange("90"), 90);
  });

  test("falls back to 30 for anything else", () => {
    assert.equal(parseRange(undefined), 30);
    assert.equal(parseRange("365"), 30);
    assert.equal(parseRange("abc"), 30);
    assert.equal(parseRange(["7", "90"]), 7);
  });
});

describe("niceMax", () => {
  test("rounds up to 1, 2, 5 or 10 times a power of ten", () => {
    assert.equal(niceMax(7), 10);
    assert.equal(niceMax(11), 20);
    assert.equal(niceMax(21), 50);
    assert.equal(niceMax(51), 100);
    assert.equal(niceMax(100), 100);
  });

  test("keeps a floor so one warn does not fill the chart", () => {
    assert.equal(niceMax(0), 5);
    assert.equal(niceMax(1), 5);
  });
});

describe("segmentsFor", () => {
  test("stacks in a fixed order and skips empty series", () => {
    const segments = segmentsFor(day("2026-09-01", 2, 0, 1, 1), 10);
    assert.deepEqual(
      segments.map((s) => [s.series, s.percent]),
      [
        ["warn", 20],
        ["kick", 10],
        ["ban", 10],
      ],
    );
  });
});

describe("axis helpers", () => {
  test("gridValues spans zero to the maximum", () => {
    assert.deepEqual(gridValues(20), [0, 5, 10, 15, 20]);
    assert.deepEqual(gridValues(10), [0, 2, 4, 6, 8, 10]);
  });

  test("labelIndexes includes both ends and never repeats", () => {
    assert.deepEqual(labelIndexes(30, 5), [0, 7, 15, 22, 29]);
    assert.deepEqual(labelIndexes(3, 5), [0, 1, 2]);
    assert.deepEqual(labelIndexes(0), []);
  });

  test("shortDate ignores the viewer timezone", () => {
    assert.equal(shortDate("2026-09-08"), "8 Sep");
    assert.equal(shortDate("2026-01-31"), "31 Jan");
  });
});

describe("chartSummary", () => {
  test("names the total and the busiest day", () => {
    const text = chartSummary({ perDay: [day("2026-09-01", 1), day("2026-09-02", 3, 1)] });
    assert.equal(text, "5 actions across 2 days. The busiest day was 2 Sep with 4.");
  });

  test("says so when nothing happened", () => {
    assert.equal(chartSummary({ perDay: [day("2026-09-01")] }), "No actions across 1 day.");
  });
});

describe("actionBars", () => {
  test("scales to the largest and drops zero rows", () => {
    const bars = actionBars([
      { action: "ban", count: 1 },
      { action: "warn", count: 4 },
      { action: "kick", count: 0 },
    ]);
    assert.deepEqual(
      bars.map((b) => [b.action, b.percent, b.share]),
      [
        ["warn", 100, 0.8],
        ["ban", 25, 0.2],
      ],
    );
  });

  test("an empty list gives no bars", () => {
    assert.deepEqual(actionBars([]), []);
  });
});

describe("share", () => {
  test("sharePercent is bounded and safe on zero", () => {
    assert.equal(sharePercent(5, 20), 25);
    assert.equal(sharePercent(5, 0), 0);
    assert.equal(sharePercent(30, 20), 100);
  });

  test("formatPercent shows a floor for tiny shares", () => {
    assert.equal(formatPercent(0.4), "<1%");
    assert.equal(formatPercent(0), "0%");
    assert.equal(formatPercent(33.4), "33%");
  });
});

describe("hours", () => {
  test("always returns 24 cells and scales against the peak", () => {
    const byHour = Array.from({ length: 24 }, () => 0);
    byHour[3] = 10;
    byHour[4] = 6;
    byHour[5] = 3;
    byHour[6] = 1;
    const cells = hourCells(byHour);
    assert.equal(cells.length, 24);
    assert.deepEqual(
      [3, 4, 5, 6, 7].map((h) => cells[h]!.level),
      [4, 3, 2, 1, 0],
    );
  });

  test("tolerates a short array", () => {
    assert.equal(hourCells([1]).length, 24);
  });

  test("peakHourText names the busiest hour, wrapping at midnight", () => {
    const byHour = Array.from({ length: 24 }, () => 0);
    assert.equal(peakHourText(byHour), null);
    byHour[23] = 2;
    assert.equal(peakHourText(byHour), "23:00 to 00:00 UTC");
  });
});

describe("repeatRateText", () => {
  test("says there is not enough data when the backend has no figure", () => {
    assert.match(repeatRateText(null).headline, /Not enough/);
  });

  test("states the share as a whole percentage", () => {
    assert.equal(repeatRateText(0.5).headline, "50% of actioned members were actioned again within 30 days");
    assert.equal(repeatRateText(0.333).headline, "33% of actioned members were actioned again within 30 days");
  });

  test("handles none repeating", () => {
    assert.match(repeatRateText(0).detail, /Nobody/);
  });

  test("rejects a value that is not a share", () => {
    assert.match(repeatRateText(3.2).headline, /Not enough/);
    assert.match(repeatRateText(-1).headline, /Not enough/);
  });
});

describe("changeBetween", () => {
  test("fewer actions is an improvement, more is not", () => {
    const down = changeBetween(8, 10, "lower")!;
    assert.deepEqual([down.trend, down.verdict, down.label], ["down", "good", "20%"]);
    const up = changeBetween(15, 10, "lower")!;
    assert.deepEqual([up.trend, up.verdict, up.label], ["up", "bad", "50%"]);
  });

  test("neutral figures never judge", () => {
    assert.equal(changeBetween(30, 10, "neutral")!.verdict, "neutral");
    assert.equal(changeBetween(0, 10, "neutral")!.verdict, "neutral");
  });

  test("no change is flat and neutral", () => {
    const same = changeBetween(4, 4, "lower")!;
    assert.deepEqual([same.trend, same.verdict, same.label], ["flat", "neutral", "No change"]);
  });

  test("an empty earlier period has no percentage", () => {
    const fresh = changeBetween(3, 0, "lower")!;
    assert.deepEqual([fresh.trend, fresh.verdict, fresh.percent, fresh.label], ["up", "bad", null, "New"]);
    assert.equal(changeBetween(0, 0, "lower")!.label, "No change");
  });

  test("returns null when there is nothing to compare with", () => {
    assert.equal(changeBetween(3, null, "lower"), null);
    assert.equal(changeBetween(3, undefined, "lower"), null);
    assert.equal(changeBetween(3, Number.NaN, "lower"), null);
  });

  test("tiny and huge swings are capped in the label", () => {
    assert.equal(changeBetween(1001, 1000, "lower")!.label, "<1%");
    assert.equal(changeBetween(5000, 2, "lower")!.label, ">999%");
  });

  test("the sentence names the earlier figure", () => {
    const change = changeBetween(8, 10, "lower")!;
    assert.equal(changeSentence(change, 10, 30), "Down 20% from 10 in the previous 30 days (better).");
    assert.equal(changeSentence(changeBetween(4, 4, "lower")!, 4, 7), "Unchanged from 4 in the previous 7 days.");
    assert.equal(changeSentence(changeBetween(15, 10, "lower")!, 10, 30), "Up 50% from 10 in the previous 30 days (worse).");
    assert.equal(changeSentence(changeBetween(30, 10, "neutral")!, 10, 30), "Up 200% from 10 in the previous 30 days.");
  });
});

describe("metrics", () => {
  const totals = { actions: 9, warns: 4, timeouts: 2, kicks: 1, bans: 2, voided: 1, notes: 6 };

  test("kicks and bans are one figure", () => {
    assert.equal(metricValue(totals, "kicksBans"), 3);
    assert.equal(metricValue(totals, "notes"), 6);
  });

  test("sparkValues follows the daily series and skips figures it does not carry", () => {
    const days = [day("2026-09-01", 1, 1, 0, 1), day("2026-09-02", 2)];
    assert.deepEqual(sparkValues(days, "actions"), [3, 2]);
    assert.deepEqual(sparkValues(days, "kicksBans"), [1, 0]);
    assert.equal(sparkValues(days, "notes"), null);
    assert.equal(sparkValues(days, "voided"), null);
  });
});

describe("sparkPaths", () => {
  test("needs at least two points", () => {
    assert.equal(sparkPaths([3], 100, 20), null);
  });

  test("a flat zero run sits on the bottom edge", () => {
    const paths = sparkPaths([0, 0, 0], 100, 20, 2)!;
    assert.equal(paths.line, "M2 18 L50 18 L98 18");
  });

  test("the tallest value touches the top padding", () => {
    const paths = sparkPaths([0, 4], 100, 20, 2)!;
    assert.equal(paths.line, "M2 18 L98 2");
    assert.ok(paths.area.endsWith("L98 18 L2 18 Z"));
  });
});

describe("periodText", () => {
  test("names both ends and the year", () => {
    assert.equal(periodText([day("2026-09-12"), day("2026-09-13"), day("2026-10-10")]), "12 Sep to 10 Oct 2026");
    assert.equal(periodText([day("2026-10-10")]), "10 Oct 2026");
    assert.equal(periodText([]), null);
  });

  test("longerRange steps up and stops at the top", () => {
    assert.equal(longerRange(7), 30);
    assert.equal(longerRange(30), 90);
    assert.equal(longerRange(90), null);
    assert.equal(longerRange(12), null);
  });
});

describe("series toggles", () => {
  const days = [day("2026-09-01", 2, 1, 0, 1), day("2026-09-02", 3, 0, 0, 0, 1)];

  test("totals and present series", () => {
    assert.deepEqual(seriesTotals(days), { warn: 5, timeout: 1, kick: 0, ban: 1, other: 1 });
    assert.deepEqual(presentSeries(days), ["warn", "timeout", "ban", "other"]);
  });

  test("hidden series drop out of totals and segments", () => {
    assert.equal(visibleTotal(days[0]!, []), 4);
    assert.equal(visibleTotal(days[0]!, ["warn"]), 2);
    assert.deepEqual(
      segmentsFor(days[0]!, 10, ["warn", "ban"]).map((s) => s.series),
      ["timeout"],
    );
  });

  test("toggled flips membership without mutating", () => {
    const start: ("warn" | "ban")[] = ["warn"];
    assert.deepEqual(toggled(start, "ban"), ["warn", "ban"]);
    assert.deepEqual(toggled(start, "warn"), []);
    assert.deepEqual(start, ["warn"]);
  });

  test("seriesOf maps unknown actions to other", () => {
    assert.equal(seriesOf("ban"), "ban");
    assert.equal(seriesOf("unban"), "other");
  });

  test("the spoken tooltip counts only what is shown", () => {
    assert.equal(tooltipSentence(days[0]!, []), "1 Sep: 4 actions (2 warns, 1 timeouts, 1 bans)");
    assert.equal(tooltipSentence(days[0]!, ["warn", "timeout"]), "1 Sep: 1 action (1 bans)");
    assert.equal(tooltipSentence(days[0]!, ["warn", "timeout", "ban"]), "1 Sep: no actions");
  });
});

describe("pointer and keyboard", () => {
  test("indexFromPosition clamps to the columns", () => {
    assert.equal(indexFromPosition(0, 300, 30), 0);
    assert.equal(indexFromPosition(155, 300, 30), 15);
    assert.equal(indexFromPosition(999, 300, 30), 29);
    assert.equal(indexFromPosition(-5, 300, 30), 0);
    assert.equal(indexFromPosition(10, 0, 30), null);
  });

  test("stepIndex moves, clamps and starts from the sensible end", () => {
    assert.equal(stepIndex(null, "ArrowLeft", 7), 6);
    assert.equal(stepIndex(null, "ArrowRight", 7), 0);
    assert.equal(stepIndex(3, "ArrowRight", 7), 4);
    assert.equal(stepIndex(6, "ArrowRight", 7), 6);
    assert.equal(stepIndex(0, "ArrowLeft", 7), 0);
    assert.equal(stepIndex(3, "Home", 7), 0);
    assert.equal(stepIndex(3, "End", 7), 6);
    assert.equal(stepIndex(3, "a", 7), 3);
    assert.equal(stepIndex(null, "End", 0), null);
  });
});

describe("moderator mix", () => {
  const mod = { total: 10, warn: 5, timeout: 2, kick: 1, ban: 1 };

  test("segments cover the whole bar, with the remainder as other", () => {
    const mix = moderatorMix(mod);
    assert.deepEqual(
      mix.map((s) => [s.series, s.count]),
      [
        ["warn", 5],
        ["timeout", 2],
        ["kick", 1],
        ["ban", 1],
        ["other", 1],
      ],
    );
    assert.equal(Math.round(mix.reduce((sum, s) => sum + s.percent, 0)), 100);
  });

  test("a moderator with no actions has an empty mix", () => {
    assert.deepEqual(moderatorMix({ total: 0, warn: 0, timeout: 0, kick: 0, ban: 0 }), []);
  });

  test("the summary skips zeros and pluralises", () => {
    assert.equal(mixSummary({ total: 4, warn: 3, timeout: 0, kick: 0, ban: 1 }), "3 warns, 1 ban");
  });

  test("automod's line counts rule actions rather than calling them all other", () => {
    assert.equal(mixSummary({ total: 2, warn: 0, timeout: 0, kick: 0, ban: 0 }), "2 other");
    assert.equal(mixSummary({ total: 2, warn: 0, timeout: 0, kick: 0, ban: 0 }, true), "2 rule actions");
    assert.equal(mixSummary({ total: 1, warn: 0, timeout: 0, kick: 0, ban: 0 }, true), "1 rule action");
    assert.equal(mixSummary({ total: 0, warn: 0, timeout: 0, kick: 0, ban: 0 }, true), "");
  });

  test("the log link carries the moderator id, encoded", () => {
    assert.equal(moderatorLogHref("123", "456"), "/guilds/123/mod/actions?moderatorId=456");
    assert.equal(moderatorLogHref("1", "a b"), "/guilds/1/mod/actions?moderatorId=a%20b");
  });
});

describe("wording helpers", () => {
  test("fullDate names the weekday in UTC", () => {
    assert.equal(fullDate("2026-10-10"), "Sat 10 Oct");
    assert.equal(fullDate("2026-01-01"), "Thu 1 Jan");
  });

  test("hourRange wraps at midnight", () => {
    assert.equal(hourRange(14), "14:00 to 15:00 UTC");
    assert.equal(hourRange(23), "23:00 to 00:00 UTC");
  });

  test("actionVerb words automod's actions and never shows an action's code name", () => {
    assert.equal(actionVerb("timeout"), "timed out");
    assert.equal(actionVerb("automod-timeout"), "timed out");
    assert.equal(actionVerb("automod-warn"), "warned");
    assert.equal(actionVerb("automod-delete"), "deleted a message from");
    assert.equal(actionVerb("mute"), "acted on");
  });

  test("repeatPercent rejects anything that is not a share", () => {
    assert.equal(repeatPercent(0.818), 82);
    assert.equal(repeatPercent(0), 0);
    assert.equal(repeatPercent(null), null);
    assert.equal(repeatPercent(2), null);
  });
});

describe("automodView", () => {
  const label = (rule: string) => rule.toUpperCase();

  test("is null when the bot sent no automod figures", () => {
    assert.equal(automodView(undefined, label, 30), null);
    assert.equal(automodView(null, label, 30), null);
  });

  test("a quiet range has no bars and a zero total", () => {
    const view = automodView({ total: 0, previousTotal: 0, byRule: [] }, label, 7)!;
    assert.equal(view.total, 0);
    assert.deepEqual(view.bars, []);
    assert.equal(view.change?.trend, "flat");
  });

  test("fewer hits than before is an improvement, more is a regression", () => {
    assert.equal(automodView({ total: 4, previousTotal: 10, byRule: [] }, label, 30)!.change?.verdict, "good");
    assert.equal(automodView({ total: 12, previousTotal: 10, byRule: [] }, label, 30)!.change?.verdict, "bad");
  });

  test("no change is shown without a previous period", () => {
    const view = automodView({ total: 4, previousTotal: null, byRule: [] }, label, 30)!;
    assert.equal(view.change, null);
    assert.equal(view.previous, null);
  });

  test("bars are scaled to the busiest rule and carry their share", () => {
    const view = automodView(
      { total: 6, previousTotal: null, byRule: [{ rule: "links", count: 4 }, { rule: "invites", count: 2 }] },
      label,
      30,
    )!;
    assert.deepEqual(
      view.bars.map((bar) => [bar.label, bar.count, bar.percent, Math.round(bar.share * 100)]),
      [["LINKS", 4, 100, 67], ["INVITES", 2, 50, 33]],
    );
    assert.match(view.summary, /6 times in the last 30 days/);
    assert.match(view.summary, /links with 4/);
  });

  test("tolerates malformed rows", () => {
    const view = automodView(
      { total: 2, byRule: [{ rule: "links", count: 2 }, { rule: "x", count: 0 }, { rule: "y", count: -1 }, null as never] },
      label,
      7,
    )!;
    assert.equal(view.bars.length, 1);
    assert.equal(automodView({ total: 1 }, label, 7)!.bars.length, 0);
  });

  test("links to the automod filter of the action log", () => {
    assert.equal(automodLogHref("42"), "/guilds/42/mod/actions?source=automod");
  });
});

describe("parseRangeSpec", () => {
  const TODAY = "2026-10-17";

  test("says when dates in the address could not be used", () => {
    const rejected = (params: { from?: string; to?: string; range?: string }) => rangeWasRejected(params, parseRangeSpec(params, TODAY));
    assert.equal(rejected({ from: "2026-10-10", to: "2026-10-01" }), true);
    assert.equal(rejected({ from: "2026-12-01", to: "2027-01-01" }), true);
    assert.equal(rejected({ from: "2026-09-01", to: "2026-09-30" }), false);
    assert.equal(rejected({}), false);
    assert.equal(rejected({ range: "all", from: "junk" }), false);
  });

  test("keeps the preset days and defaults to 30", () => {
    assert.deepEqual(parseRangeSpec({ days: "7" }, TODAY), { kind: "days", days: 7 });
    assert.deepEqual(parseRangeSpec({}, TODAY), { kind: "days", days: 30 });
  });

  test("reads all time", () => {
    assert.deepEqual(parseRangeSpec({ range: "all", days: "7" }, TODAY), { kind: "all" });
    assert.deepEqual(parseRangeSpec({ range: "everything" }, TODAY), { kind: "days", days: 30 });
  });

  test("accepts a valid custom range and pulls a future end back to today", () => {
    assert.deepEqual(parseRangeSpec({ from: "2026-09-01", to: "2026-09-30" }, TODAY), {
      kind: "custom",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    assert.deepEqual(parseRangeSpec({ from: "2026-10-01", to: "2026-12-25" }, TODAY), {
      kind: "custom",
      from: "2026-10-01",
      to: "2026-10-17",
    });
  });

  test("falls back for bad, reversed, future or too long ranges", () => {
    const fallback = { kind: "days", days: 30 };
    assert.deepEqual(parseRangeSpec({ from: "2026-02-30", to: "2026-03-05" }, TODAY), fallback);
    assert.deepEqual(parseRangeSpec({ from: "yesterday", to: "2026-03-05" }, TODAY), fallback);
    assert.deepEqual(parseRangeSpec({ from: "2026-09-30", to: "2026-09-01" }, TODAY), fallback);
    assert.deepEqual(parseRangeSpec({ from: "2026-11-01", to: "2026-11-05" }, TODAY), fallback);
    assert.deepEqual(parseRangeSpec({ from: "2024-01-01", to: "2026-10-01" }, TODAY), fallback);
    assert.deepEqual(parseRangeSpec({ to: "2026-10-01" }, TODAY), fallback);
    assert.deepEqual(parseRangeSpec({ from: "2026-09-30", to: "2026-09-01", days: "90" }, TODAY), { kind: "days", days: 90 });
  });

  test("allows exactly two years", () => {
    assert.equal(parseRangeSpec({ from: "2024-10-17", to: "2026-10-17" }, TODAY).kind, "custom");
    assert.equal(parseRangeSpec({ from: "2024-10-16", to: "2026-10-17" }, TODAY).kind, "days");
  });

  test("dayMs only takes real calendar dates", () => {
    assert.equal(dayMs("2028-02-29"), Date.UTC(2028, 1, 29));
    assert.equal(dayMs("2026-02-29"), null);
    assert.equal(dayMs(undefined), null);
  });
});

describe("range links", () => {
  test("each kind has its own query", () => {
    assert.equal(rangeQuery({ kind: "days", days: 7 }), "days=7");
    assert.equal(rangeQuery({ kind: "all" }), "range=all");
    assert.equal(rangeQuery({ kind: "custom", from: "2026-09-01", to: "2026-09-30" }), "from=2026-09-01&to=2026-09-30");
    assert.deepEqual(rangeParams({ kind: "all" }), { range: "all" });
  });

  test("the page and the export use the same range", () => {
    const spec = { kind: "custom", from: "2026-09-01", to: "2026-09-30" } as const;
    assert.equal(rangeHref("42", spec), "/guilds/42/mod?from=2026-09-01&to=2026-09-30");
    assert.equal(statsExportHref("42", spec), "/api/guilds/42/mod/stats/export?from=2026-09-01&to=2026-09-30");
    assert.equal(statsExportHref("42", { kind: "days", days: 30 }), "/api/guilds/42/mod/stats/export?days=30");
  });

  test("an unknown bucket reads as days", () => {
    assert.equal(bucketOf(undefined), "day");
    assert.equal(bucketOf("week"), "week");
    assert.equal(bucketOf("year"), "day");
  });
});

describe("range wording", () => {
  test("rangePhrase finishes a sentence for each kind of range", () => {
    assert.equal(rangePhrase({ days: 30, since: "2026-09-18T00:00:00.000Z" }), "in the last 30 days");
    assert.equal(rangePhrase({ days: 1, since: "2026-10-17T00:00:00.000Z", range: "days" }), "in the last 1 day");
    assert.equal(rangePhrase({ days: 400, since: "2025-03-14T00:00:00.000Z", until: "2026-10-17", range: "all" }), "since 14 Mar 2025");
    assert.equal(
      rangePhrase({ days: 30, since: "2026-09-01T00:00:00.000Z", until: "2026-09-30", range: "custom" }),
      "from 1 Sep to 30 Sep 2026",
    );
    assert.equal(
      rangePhrase({ days: 60, since: "2025-12-01T00:00:00.000Z", until: "2026-01-29", range: "custom" }),
      "from 1 Dec 2025 to 29 Jan 2026",
    );
    assert.equal(rangePhrase({ days: 1, since: "2026-09-01T00:00:00.000Z", until: "2026-09-01", range: "custom" }), "on 1 Sep 2026");
  });

  test("periodText ends on the last day of the last bucket and shows both years when needed", () => {
    assert.equal(
      periodText([{ ...day("2025-03-14"), end: "2025-03-31" }, { ...day("2026-10-01"), end: "2026-10-17" }]),
      "14 Mar 2025 to 17 Oct 2026",
    );
  });

  test("automodView words other ranges from the phrase it is given", () => {
    const view = automodView({ total: 3, previousTotal: null, byRule: [] }, (rule) => rule, "since 14 Mar 2025")!;
    assert.equal(view.summary, "Automod acted 3 times since 14 Mar 2025.");
  });
});

describe("week and month points", () => {
  const week = { ...day("2026-10-05", 2, 1), end: "2026-10-11" };
  const month = { ...day("2026-03-01", 4), end: "2026-03-31" };

  test("labels and titles", () => {
    assert.equal(pointLabel(week, "week"), "5 Oct");
    assert.equal(pointTitle(week, "week"), "5 Oct to 11 Oct");
    assert.equal(pointTitle({ ...week, end: "2026-10-05" }, "week"), "5 Oct");
    assert.equal(pointLabel(month, "month"), "Mar 2026");
    assert.equal(pointTitle(month, "month"), "Mar 2026");
    assert.equal(monthLabel("2026-12-01"), "Dec 2026");
    assert.equal(longDate("2026-10-05"), "5 Oct 2026");
  });

  test("tooltip and chart summary name the bucket", () => {
    assert.equal(tooltipSentence(week, [], "week"), "5 Oct to 11 Oct: 3 actions (2 warns, 1 timeouts)");
    assert.equal(
      chartSummary({ perDay: [week, { ...day("2026-10-12", 1), end: "2026-10-17" }], bucket: "week" }),
      "4 actions across 2 weeks. The busiest week was 5 Oct to 11 Oct with 3.",
    );
    assert.equal(chartSummary({ perDay: [month], bucket: "month" }), "4 actions across 1 month. The busiest month was Mar 2026 with 4.");
  });
});
