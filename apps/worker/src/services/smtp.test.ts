import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildListUnsubscribeHeaders } from "./smtp";

describe("buildListUnsubscribeHeaders", () => {
  it("builds RFC 8058 List-Unsubscribe and List-Unsubscribe-Post headers when given an https unsubscribe URL", () => {
    const headers = buildListUnsubscribeHeaders(
      "bymichaelliang@gmail.com",
      "https://news.michaelliang.dev/feed/unsubscribe?token=abc123",
    );

    assert.deepEqual(headers, {
      "List-Unsubscribe":
        "<https://news.michaelliang.dev/feed/unsubscribe?token=abc123>, <mailto:bymichaelliang@gmail.com?subject=unsubscribe>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("falls back to mailto List-Unsubscribe when unsubscribeUrl is omitted or invalid", () => {
    const headers = buildListUnsubscribeHeaders("bymichaelliang@gmail.com", "javascript:alert(1)");

    assert.deepEqual(headers, {
      "List-Unsubscribe": "<mailto:bymichaelliang@gmail.com?subject=unsubscribe>",
    });
  });
});
