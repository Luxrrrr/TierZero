import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitMessageLink } from "../dist/backfill.js";

const link = "https://discord.com/channels/1558837695382425641/1558837695973695550/1559010743503036480";

describe("splitMessageLink", () => {
  test("takes the link line off a reason and keeps the rest", () => {
    const result = splitMessageLink(`Test warning
Message: ${link}`);
    assert.equal(result?.rest, "Test warning");
    assert.deepEqual(result?.ref, { channelId: "1558837695973695550", messageId: "1559010743503036480" });
  });

  test("a reason that was only the link leaves nothing", () => {
    assert.equal(splitMessageLink(`Message: ${link}`)?.rest, null);
  });

  test("other reasons are left alone", () => {
    assert.equal(splitMessageLink(null), null);
    assert.equal(splitMessageLink("spam"), null);
    assert.equal(splitMessageLink("Message: https://example.com/x"), null);
  });
});
