import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isSameOriginWrite, utf8Length } from "../lib/mod-proxy.ts";
import {
  downloadFileName,
  TICKET_PROXY_MAX_BODY_BYTES,
  TICKET_PROXY_MAX_REPLY_BODY_BYTES,
  TICKET_WRITE_ACTIONS,
  ticketProxyBodyLimit,
  ticketProxyClass,
  ticketProxyTimeoutMs,
  ticketTarget,
  transcriptDownload,
  transcriptHeaders,
} from "../lib/tickets-proxy.ts";

const VIEWER = "500000000000000001";

describe("ticketProxyClass", () => {
  test("paths outside the allowlist are not served", () => {
    assert.equal(ticketProxyClass("GET", []), null);
    assert.equal(ticketProxyClass("GET", ["config"]), null);
    assert.equal(ticketProxyClass("GET", ["member"]), null);
    assert.equal(ticketProxyClass("GET", ["mod", "stats"]), null);
  });

  test("the workspace reads are open to anyone signed in, for the bot to decide", () => {
    for (const root of ["access", "context", "list", "count", "members", "stats"]) {
      assert.equal(ticketProxyClass("GET", [root]), "workspace", root);
      assert.equal(ticketProxyClass("POST", [root]), null, root);
      assert.equal(ticketProxyClass("GET", [root, "extra"]), null, root);
    }
  });

  test("a ticket, its messages and its transcripts are workspace reads", () => {
    assert.equal(ticketProxyClass("GET", ["items", "42"]), "workspace");
    assert.equal(ticketProxyClass("GET", ["items", "42", "messages"]), "workspace");
    assert.equal(ticketProxyClass("GET", ["items", "42", "transcript.html"]), "workspace");
    assert.equal(ticketProxyClass("GET", ["items", "42", "transcript.txt"]), "workspace");
    assert.equal(ticketProxyClass("GET", ["items", "42", "notes"]), null);
    assert.equal(ticketProxyClass("GET", ["items"]), null);
  });

  test("every ticket action is a POST and nothing else", () => {
    for (const action of TICKET_WRITE_ACTIONS) {
      assert.equal(ticketProxyClass("POST", ["items", "42", action]), "workspace", action);
      for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
        assert.equal(ticketProxyClass(method, ["items", "42", action]), null, `${method} ${action}`);
      }
    }
    assert.deepEqual(
      [...TICKET_WRITE_ACTIONS].sort(),
      ["claim", "close", "members", "notes", "priority", "rename", "reopen", "reply", "request-close", "transfer", "unclaim"],
    );
    assert.equal(ticketProxyClass("POST", ["items", "42", "explode"]), null);
    assert.equal(ticketProxyClass("POST", ["items", "42"]), null);
  });

  test("deleting a transcript and the panels need Manage Server", () => {
    assert.equal(ticketProxyClass("DELETE", ["items", "42", "transcript"]), "manager");
    assert.equal(ticketProxyClass("DELETE", ["items", "42"]), null);
    assert.equal(ticketProxyClass("GET", ["panels"]), "manager");
    assert.equal(ticketProxyClass("POST", ["panels", "main", "post"]), "manager");
    assert.equal(ticketProxyClass("POST", ["panels"]), null);
    assert.equal(ticketProxyClass("GET", ["panels", "main", "post"]), null);
    assert.equal(ticketProxyClass("POST", ["panels", "main", "post", "again"]), null);
  });

  test("malformed ids and dot segments are refused", () => {
    for (const id of ["0", "-1", "1e3", "abc", "42.0", "0042", "1234567890", " 42"]) {
      assert.equal(ticketProxyClass("GET", ["items", id]), null, id);
    }
    assert.equal(ticketProxyClass("GET", ["items", ".."]), null);
    assert.equal(ticketProxyClass("GET", ["items", "42", ".."]), null);
    assert.equal(ticketProxyClass("GET", ["list", ""]), null);
    assert.equal(ticketProxyClass("GET", ["."]), null);
    assert.equal(ticketProxyClass("POST", ["panels", "../mod", "post"]), null);
    assert.equal(ticketProxyClass("POST", ["panels", "a/b", "post"]), null);
    assert.equal(ticketProxyClass("POST", ["panels", "a\\b", "post"]), null);
    assert.equal(ticketProxyClass("GET", ["items", "42", "a/b"]), null);
    assert.equal(ticketProxyClass("POST", ["panels", "x".repeat(33), "post"]), null);
  });
});

describe("ticketTarget", () => {
  test("the viewer is always the signed-in user, whatever the browser sent", () => {
    const target = ticketTarget(["list"], new URLSearchParams(`viewer=666666666666666666&status=closed`), VIEWER, "GET");
    const query = new URLSearchParams(target.split("?")[1]);
    assert.deepEqual(query.getAll("viewer"), [VIEWER]);
    assert.equal(query.get("status"), "closed");
  });

  test("only the keys a route reads are passed on", () => {
    const search = new URLSearchParams("days=7&q=x&owner=1&role=owner&manager=1");
    assert.equal(ticketTarget(["stats"], search, VIEWER, "GET"), `stats?days=7&viewer=${VIEWER}`);
    assert.equal(ticketTarget(["context"], search, VIEWER, "GET"), `context?viewer=${VIEWER}`);
    assert.equal(
      ticketTarget(["items", "42", "messages"], new URLSearchParams("after=9&q=1"), VIEWER, "GET"),
      `items/42/messages?after=9&viewer=${VIEWER}`,
    );
  });

  test("the count takes the list's filters and the cursor, the member search its own keys", () => {
    const search = new URLSearchParams("status=all&type=a&after=12&q=%2361&viewer=666666666666666666&days=7");
    const count = new URLSearchParams(ticketTarget(["count"], search, VIEWER, "GET").split("?")[1]);
    assert.equal(count.get("after"), "12");
    assert.equal(count.get("q"), "#61");
    assert.equal(count.get("days"), null);
    assert.deepEqual(count.getAll("viewer"), [VIEWER]);
    assert.equal(new URLSearchParams(ticketTarget(["list"], search, VIEWER, "GET").split("?")[1]).get("after"), "12");
    assert.equal(
      ticketTarget(["members"], new URLSearchParams("q=frag&ids=1,2&status=open"), VIEWER, "GET"),
      `members?q=frag&ids=1%2C2&viewer=${VIEWER}`,
    );
  });

  test("repeated list filters survive", () => {
    const target = ticketTarget(["list"], new URLSearchParams("type=a&type=b"), VIEWER, "GET");
    assert.deepEqual(new URLSearchParams(target.split("?")[1]).getAll("type"), ["a", "b"]);
  });

  test("writes carry no query; the actor goes in the body", () => {
    assert.equal(ticketTarget(["items", "42", "claim"], new URLSearchParams(`viewer=${VIEWER}`), VIEWER, "POST"), "items/42/claim");
  });

  test("segments are encoded", () => {
    assert.equal(ticketTarget(["items", "42", "transcript.html"], new URLSearchParams(), VIEWER, "GET"), `items/42/transcript.html?viewer=${VIEWER}`);
  });
});

describe("transcript downloads", () => {
  test("only the two transcript paths are downloads", () => {
    assert.deepEqual(transcriptDownload("GET", ["items", "42", "transcript.html"]), { format: "html", filename: "ticket-42-transcript.html" });
    assert.deepEqual(transcriptDownload("GET", ["items", "42", "transcript.txt"]), { format: "txt", filename: "ticket-42-transcript.txt" });
    assert.equal(transcriptDownload("GET", ["items", "42"]), null);
    assert.equal(transcriptDownload("DELETE", ["items", "42", "transcript.html"]), null);
    assert.equal(transcriptDownload("GET", ["items", "x", "transcript.html"]), null);
  });

  test("the HTML is a sandboxed attachment that cannot run or be sniffed", () => {
    const headers = transcriptHeaders("html", "ticket-42-transcript.html");
    assert.equal(headers["content-disposition"], 'attachment; filename="ticket-42-transcript.html"');
    assert.equal(headers["x-content-type-options"], "nosniff");
    const csp = headers["content-security-policy"] ?? "";
    assert.match(csp, /^sandbox;/);
    assert.match(csp, /default-src 'none'/);
    assert.ok(!csp.includes("script-src"));
    assert.ok(!csp.includes("allow-scripts"));
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(headers["content-type"], "text/html; charset=utf-8");
  });

  test("the bot's file name, which carries the server's own number, is used when it is plain", () => {
    assert.equal(downloadFileName('attachment; filename="ticket-7.html"', "ticket-42-transcript.html"), "ticket-7.html");
    assert.equal(downloadFileName(null, "ticket-42-transcript.html"), "ticket-42-transcript.html");
    assert.equal(downloadFileName('attachment; filename="../x y.html"', "fallback.html"), "fallback.html");
  });

  test("a file name cannot break out of the header", () => {
    const headers = transcriptHeaders("txt", 'a"; filename=evil.html\r\nx: y');
    assert.equal(headers["content-disposition"], 'attachment; filename="a___filename_evil.html__x__y"');
    assert.equal(headers["content-type"], "text/plain; charset=utf-8");
  });
});

describe("same origin and body size", () => {
  const headers = (origin: string | null, host = "dash.example.com", secFetchSite: string | null = "same-origin") => ({
    origin,
    host,
    secFetchSite,
    forwardedHost: null,
  });

  test("reads pass, writes need the dashboard's own origin", () => {
    assert.equal(isSameOriginWrite("GET", headers(null)), true);
    assert.equal(isSameOriginWrite("POST", headers("https://dash.example.com")), true);
    assert.equal(isSameOriginWrite("POST", headers("https://evil.example.com")), false);
    assert.equal(isSameOriginWrite("DELETE", headers(null)), false);
    assert.equal(isSameOriginWrite("POST", headers("https://dash.example.com", "dash.example.com", "cross-site")), false);
  });

  test("only a reply may carry files, with room for their base64", () => {
    assert.equal(ticketProxyBodyLimit("POST", ["items", "42", "reply"]), TICKET_PROXY_MAX_REPLY_BODY_BYTES);
    assert.ok(TICKET_PROXY_MAX_REPLY_BODY_BYTES >= Math.ceil((8 * 1024 * 1024 * 4) / 3));
    assert.ok(TICKET_PROXY_MAX_REPLY_BODY_BYTES < 12 * 1024 * 1024);
    for (const action of ["claim", "notes", "rename", "request-close", "members"]) {
      assert.equal(ticketProxyBodyLimit("POST", ["items", "42", action]), TICKET_PROXY_MAX_BODY_BYTES, action);
    }
    assert.equal(ticketProxyBodyLimit("GET", ["items", "42", "reply"]), TICKET_PROXY_MAX_BODY_BYTES);
    assert.equal(ticketProxyTimeoutMs("POST", ["items", "42", "reply"]), 60_000);
    assert.equal(ticketProxyTimeoutMs("POST", ["items", "42", "claim"]), undefined);
  });

  test("the cap is 32 KB measured in bytes", () => {
    assert.equal(TICKET_PROXY_MAX_BODY_BYTES, 32 * 1024);
    assert.equal(utf8Length("é".repeat(16 * 1024 + 1)) > TICKET_PROXY_MAX_BODY_BYTES, true);
  });
});
