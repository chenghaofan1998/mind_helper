import assert from "node:assert/strict";
import test from "node:test";
import { listSources, writeKnowledge } from "./client.js";

test("client sends the injected session token and preserves typed write failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
  Object.defineProperty(globalThis, "document", {
    value: { querySelector: () => ({ content: "runtime-session-token" }) },
    configurable: true,
  });
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(new Headers(init?.headers).get("X-Action-Pocket-Token"), "runtime-session-token");
      if (String(input).endsWith("/api/sources")) {
        return new Response(JSON.stringify({ sources: [{ id: "s", name: "Source", capabilities: ["search"], searchMode: "source", searchDescription: "source search" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, code: "PATH_OUTSIDE_SOURCE", message: "invalid target" }), { status: 400 });
    };
    assert.deepEqual((await listSources())[0].capabilities, ["search"]);
    const receipt = await writeKnowledge({ rawContent: "x", target: { sourceId: "s", relativePath: "../x.md" } });
    assert.deepEqual(receipt, { ok: false, code: "PATH_OUTSIDE_SOURCE", message: "invalid target" });
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: originalDocument, configurable: true });
  }
});
