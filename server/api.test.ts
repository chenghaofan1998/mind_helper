import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApiMiddleware } from "./api.js";
import { SourceRegistry } from "./sourceRegistry.js";
import { FileGraphSource } from "./sources/fileGraph.js";

async function apiServer() {
  const source = new FileGraphSource(await mkdtemp(join(tmpdir(), "action-pocket-api-")));
  await source.initialize();
  const registry = new SourceRegistry();
  registry.register(source);
  const token = randomBytes(32).toString("base64url");
  const middleware = createApiMiddleware(Promise.resolve(registry), token);
  const server = createServer((request, response) => {
    void middleware(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    browserHeaders: { "x-action-pocket-token": token, origin: base },
    nonBrowserHeaders: { "x-action-pocket-token": token },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("HTTP contract exposes capabilities and typed validation failures", async () => {
  const server = await apiServer();
  try {
    let response = await fetch(`${server.base}/api/sources`, { headers: server.browserHeaders });
    const sources = await response.json() as { sources: Array<{ capabilities: string[]; searchMode: string }> };
    assert.equal(response.status, 200);
    assert.deepEqual(sources.sources[0].capabilities, ["read", "search", "write", "locate"]);
    assert.equal(sources.sources[0].searchMode, "lexical-fallback");

    response = await fetch(`${server.base}/api/write`, {
      method: "POST", headers: { "content-type": "application/json", ...server.browserHeaders }, body: JSON.stringify({ rawContent: "x" }),
    });
    const failure = await response.json() as { ok: boolean; code: string; message: string };
    assert.equal(response.status, 400);
    assert.equal(failure.ok, false);
    assert.equal(failure.code, "INVALID_INPUT");
    assert.ok(failure.message.length > 0);
  } finally {
    await server.close();
  }
});

test("HTTP requires the runtime token, checks browser origin, and accepts token-authenticated non-browser clients", async () => {
  const server = await apiServer();
  try {
    let response = await fetch(`${server.base}/api/write`, {
      method: "POST", headers: { "content-type": "text/plain", ...server.browserHeaders }, body: JSON.stringify({}),
    });
    assert.equal(response.status, 415);
    assert.equal((await response.json() as { code: string }).code, "UNSUPPORTED_MEDIA_TYPE");

    const unauthorizedHeaders: Array<Record<string, string>> = [
      { "content-type": "application/json" },
      { "content-type": "application/json", origin: server.base },
      { "content-type": "application/json", ...server.nonBrowserHeaders, origin: "https://malicious.example" },
    ];
    for (const headers of unauthorizedHeaders) {
      response = await fetch(`${server.base}/api/write`, {
        method: "POST",
        headers,
        body: JSON.stringify({ rawContent: "x", target: { sourceId: "file-graph", relativePath: "x.md" } }),
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json() as { code: string }).code, "FORBIDDEN");
    }

    response = await fetch(`${server.base}/api/sources`, { headers: server.nonBrowserHeaders });
    assert.equal(response.status, 200);
  } finally {
    await server.close();
  }
});

test("HTTP search rejects wrong optional field types and bounds", async () => {
  const server = await apiServer();
  try {
    for (const body of [
      { query: "needle", sourceId: 123 },
      { query: "needle", limit: "1" },
      { query: "needle", limit: 1.5 },
      { query: "needle", limit: 0 },
      { query: "needle", limit: 6 },
    ]) {
      const response = await fetch(`${server.base}/api/search`, {
        method: "POST",
        headers: { "content-type": "application/json", ...server.browserHeaders },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json() as { code: string }).code, "INVALID_INPUT");
    }
  } finally {
    await server.close();
  }
});

test("HTTP write and bounded search complete the source round trip", async () => {
  const server = await apiServer();
  try {
    const headers = { "content-type": "application/json", ...server.browserHeaders };
    let response = await fetch(`${server.base}/api/write`, {
      method: "POST", headers, body: JSON.stringify({ rawContent: "api-round-trip", target: { sourceId: "file-graph", relativePath: "inbox/api.md" } }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { ok: boolean }).ok, true);
    response = await fetch(`${server.base}/api/search`, {
      method: "POST", headers, body: JSON.stringify({ query: "api-round-trip", sourceId: "file-graph", limit: 5 }),
    });
    const result = await response.json() as { results: Array<{ location: { path: string; line: number } }> };
    assert.equal(response.status, 200);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].location.path, "inbox/api.md");
    assert.equal(result.results[0].location.line, 1);
  } finally {
    await server.close();
  }
});
