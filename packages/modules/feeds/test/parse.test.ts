import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, stripHtml } from "../dist/parse.js";

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Rockstar Newswire</title>
    <item>
      <title>Trailer &amp; more</title>
      <link>https://example.com/a</link>
      <guid isPermaLink="false">abc-1</guid>
      <pubDate>Tue, 06 Oct 2026 12:00:00 GMT</pubDate>
      <description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;</description>
      <media:thumbnail url="https://example.com/a.jpg"/>
    </item>
    <item>
      <title>No guid here</title>
      <link>https://example.com/b</link>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Some Channel</title>
  <entry>
    <id>yt:video:123</id>
    <title>New trailer</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=123"/>
    <published>2026-10-05T10:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/123/hq.jpg" width="480" height="360"/>
      <media:description>Watch it now</media:description>
    </media:group>
  </entry>
</feed>`;

describe("parseFeed", () => {
  test("reads an RSS item with its guid, date, summary and thumbnail", () => {
    const feed = parseFeed(RSS);
    assert.equal(feed.title, "Rockstar Newswire");
    const [first] = feed.items;
    assert.equal(first?.id, "abc-1");
    assert.equal(first?.title, "Trailer & more");
    assert.equal(first?.link, "https://example.com/a");
    assert.equal(first?.summary, "Hello world");
    assert.equal(first?.image, "https://example.com/a.jpg");
    assert.equal(first?.publishedAt?.toISOString(), "2026-10-06T12:00:00.000Z");
  });

  test("falls back to the link as an id when an RSS item has no guid", () => {
    assert.equal(parseFeed(RSS).items[1]?.id, "https://example.com/b");
  });

  test("reads an Atom entry, taking its image and description from media:group", () => {
    const [entry] = parseFeed(ATOM).items;
    assert.equal(entry?.id, "yt:video:123");
    assert.equal(entry?.link, "https://www.youtube.com/watch?v=123");
    assert.equal(entry?.image, "https://i.ytimg.com/vi/123/hq.jpg");
    assert.equal(entry?.summary, "Watch it now");
  });

  test("reads a feed with a single item, which the parser does not wrap in a list", () => {
    const xml = `<rss><channel><title>t</title><item><title>only</title><guid>1</guid></item></channel></rss>`;
    assert.equal(parseFeed(xml).items.length, 1);
  });

  test("returns no items for a feed that is empty", () => {
    assert.deepEqual(parseFeed(`<rss><channel><title>t</title></channel></rss>`).items, []);
  });

  test("refuses a link that is not http or https", () => {
    const xml = `<rss><channel><item><title>x</title><guid>1</guid><link>javascript:alert(1)</link></item></channel></rss>`;
    assert.equal(parseFeed(xml).items[0]?.link, null);
  });

  test("says so when the document is not a feed", () => {
    assert.throws(() => parseFeed("<html><body>hi</body></html>"), /RSS or Atom/);
  });
});

describe("stripHtml", () => {
  test("turns paragraphs into line breaks and drops tags and entities", () => {
    assert.equal(stripHtml("<p>One &amp; two</p><p>Three</p>"), "One & two\nThree");
  });

  test("removes scripts and styles along with their contents", () => {
    assert.equal(stripHtml("a<script>alert(1)</script>b<style>x{}</style>c"), "abc");
  });
});

describe("stripHtml on hostile text", () => {
  const within = (limitMs: number, work: () => void) => {
    const started = Date.now();
    work();
    assert.ok(Date.now() - started < limitMs, `took ${Date.now() - started}ms`);
  };

  test("a long run of opening brackets is not quadratic", () => {
    within(500, () => stripHtml("<".repeat(2_000_000)));
  });

  test("many script openers with no closer are not quadratic", () => {
    within(500, () => stripHtml("<script ".repeat(250_000)));
  });

  test("an unclosed script drops what follows it and an unclosed tag stays as text", () => {
    assert.equal(stripHtml("before<script>never closed"), "before");
    assert.equal(stripHtml("a < b and c"), "a < b and c");
  });

  test("a numeric reference outside the Unicode range is dropped instead of throwing", () => {
    assert.equal(stripHtml("a&#1114112;b&#55296;c"), "a&#1114112;b&#55296;c".replace("&#1114112;", "").replace("&#55296;", ""));
  });
});
