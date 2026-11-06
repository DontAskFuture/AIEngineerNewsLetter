import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalizeUrl } from "./url";

describe("canonicalizeUrl", () => {
  it("strips tracking query parameters, hashes, default ports, and trailing slashes", () => {
    assert.equal(
      canonicalizeUrl(
        "https://example.com:443/blog/post/?utm_source=newsletter&utm_medium=email&fbclid=123&gclid=456&mc_cid=789&mc_eid=012&ref=hn&ref_src=tw&keep=1#section",
      ),
      "https://example.com/blog/post?keep=1",
    );
    assert.equal(canonicalizeUrl("http://example.com:80/"), "http://example.com/");
    assert.equal(
      canonicalizeUrl("https://example.com:8443/blog/post/"),
      "https://example.com:8443/blog/post",
    );
  });

  it("rejects non-http(s) protocols and embedded credentials", () => {
    assert.throws(() => canonicalizeUrl("javascript:alert(1)"), /Unsupported URL protocol/);
    assert.throws(
      () => canonicalizeUrl("data:text/html,<script>alert(1)</script>"),
      /Unsupported URL protocol/,
    );
    assert.throws(() => canonicalizeUrl("file:///etc/passwd"), /Unsupported URL protocol/);
    assert.throws(
      () => canonicalizeUrl("https://user:pass@example.com/blog"),
      /embedded credentials/,
    );
  });
});
