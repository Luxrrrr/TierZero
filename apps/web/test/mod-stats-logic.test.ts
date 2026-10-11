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

  test("actionVerb falls back for unknown actions", () => {
    assert.equal(actionVerb("timeout"), "timed out");
    assert.equal(actionVerb("mute"), "acted on (mute)");
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
