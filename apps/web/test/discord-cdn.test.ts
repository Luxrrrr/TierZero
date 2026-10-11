import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cdnSize, guildIconUrl, initialsOf } from "../lib/discord-cdn.ts";

/**
 * The control API sends Discord's icon hash rather than a ready-made URL, so
 * that each surface can ask the CDN for the size it draws at. A build that
 * sent the URL instead produced a src with the CDN host in it twice, which
 * fails silently as a broken image.
 */
describe("cdnSize", () => {
  test("rounds up to the next power of two, which is all the CDN accepts", () => {
    assert.equal(cdnSize(48), 64);
    assert.equal(cdnSize(72), 128);
    assert.equal(cdnSize(96), 128);
    assert.equal(cdnSize(64), 64);
  });

  test("stays inside the range the CDN documents", () => {
    assert.equal(cdnSize(1), 16);
    assert.equal(cdnSize(100000), 4096);
  });
});

describe("guildIconUrl", () => {
  test("builds a CDN url from a hash", () => {
    assert.equal(
      guildIconUrl("123", "abcdef", 96),
      "https://cdn.discordapp.com/icons/123/abcdef.webp?size=128",
    );
  });

  test("asks for a gif when the hash marks an animated icon", () => {
    assert.equal(
      guildIconUrl("123", "a_abcdef", 48),
      "https://cdn.discordapp.com/icons/123/a_abcdef.gif?size=64",
    );
  });

  test("returns null for a server with no icon", () => {
    assert.equal(guildIconUrl("123", null), null);
  });

  test("defaults to a size rather than leaving it to the CDN", () => {
    assert.match(guildIconUrl("123", "abcdef") ?? "", /\?size=64$/);
  });
});

describe("initialsOf", () => {
  test("takes the first letter of up to two words", () => {
    assert.equal(initialsOf("Cool Server"), "CS");
    assert.equal(initialsOf("Cool Server Of Doom"), "CS");
  });

  test("falls back to one letter for a single word", () => {
    assert.equal(initialsOf("tier0"), "T");
  });

  test("gives a placeholder rather than an empty badge", () => {
    assert.equal(initialsOf("   "), "?");
  });
});
