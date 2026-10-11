import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cleanSteamBody, isPatchNotes, logoUrl, parseSteamNews, steamNewsUrl } from "../dist/steam.js";

const post = (title: string, tags: string[] = []) => ({ title, tags });

describe("isPatchNotes", () => {
  test("trusts the patchnotes tag whatever the title says", () => {
    assert.equal(isPatchNotes(post("Counter-Strike 2 Update", ["patchnotes"])), true);
  });

  test("recognises titles studios actually use", () => {
    for (const title of ["Patch 2.31", "Update 2.3 Patch Notes", "Update 2.2 is live!", "Hotfix 1.2.1", "Changelog for v0.9", "Winter Update"]) {
      assert.equal(isPatchNotes(post(title)), true, title);
    }
  });

  test("leaves out announcements about an update that has not shipped", () => {
    for (const title of ["REDstreams — Update 2.2 is coming!", "Update 3.0 preview", "Patch notes soon"]) {
      assert.equal(isPatchNotes(post(title)), false, title);
    }
  });

  test("leaves out ordinary announcements", () => {
    for (const title of ["5th Anniversary Trailer — City of Legends", "Blocktober 3 — Andrzej Giełzak", "Photo Mode Challenge 3.0"]) {
      assert.equal(isPatchNotes(post(title)), false, title);
    }
  });
});

describe("parseSteamNews", () => {
  test("reads the fields it needs and converts the date from seconds", () => {
    const [first] = parseSteamNews({
      appnews: {
        newsitems: [
          { gid: "123", title: "Patch 1", url: "https://s.team/x", contents: "body", author: "dev", date: 1_700_000_000, tags: ["patchnotes"] },
        ],
      },
    });
    assert.equal(first?.id, "123");
    assert.equal(first?.publishedAt.getTime(), 1_700_000_000_000);
    assert.deepEqual(first?.tags, ["patchnotes"]);
  });

  test("skips an entry that is missing a title or address", () => {
    const posts = parseSteamNews({ appnews: { newsitems: [{ gid: "1" }, { gid: "2", title: "ok", url: "https://s.team/y", date: 1 }] } });
    assert.deepEqual(posts.map((p) => p.id), ["2"]);
  });

  test("throws when the response is not what Steam normally sends", () => {
    assert.throws(() => parseSteamNews({ nope: true }), /unexpected/);
  });
});

describe("cleanSteamBody", () => {
  test("drops images and keeps list items readable", () => {
    const raw = "[h2]Fixes[/h2][list][*]One[*]Two[/list][img]{STEAM_CLAN_IMAGE}/x.png[/img]";
    assert.equal(cleanSteamBody(raw), "**Fixes**\n• One• Two");
  });

  test("keeps the text of a link and discards the address", () => {
    assert.equal(cleanSteamBody("[url=https://example.com]read more[/url]"), "read more");
  });
});

describe("logoUrl", () => {
  test("points at the game's logo on Steam's CDN", () => {
    assert.equal(logoUrl(1091500), "https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/logo.png");
  });
});

describe("steamNewsUrl", () => {
  test("asks for the developer's own announcements only", () => {
    assert.match(steamNewsUrl(730), /feeds=steam_community_announcements/);
    assert.match(steamNewsUrl(730), /appid=730/);
  });
});
