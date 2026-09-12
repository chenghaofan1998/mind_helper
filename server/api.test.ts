import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { KnowledgeErrorCode, KnowledgeSearchResults, KnowledgeSource } from "../src/knowledge/types.js";
import { createApiMiddleware } from "./api.js";
import { KnowledgeSourceError } from "./errors.js";
import { registryFromEnvironment, SourceRegistry } from "./sourceRegistry.js";
import { FileGraphSource } from "./sources/fileGraph.js";

async function apiServer(sourceOverride?: KnowledgeSource, reveal: (path: string) => Promise<void> = async () => {}, registryOverride?: SourceRegistry) {
  const source = sourceOverride ?? new FileGraphSource(await mkdtemp(join(tmpdir(), "action-pocket-api-")));
  if (source instanceof FileGraphSource) await source.initialize();
  const registry = registryOverride ?? new SourceRegistry();
  if (!registryOverride) registry.register(source);
  const token = randomBytes(32).toString("base64url");
  const middleware = createApiMiddleware(Promise.resolve(registry), token, reveal);
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
      { query: "" },
      { query: "x".repeat(501) },
      { query: "needle", sourceId: 123 },
      { query: "needle", limit: "1" },
      { query: "needle", limit: 1.5 },
      { query: "needle", limit: 0 },
      { query: "needle", limit: 6 },
      { query: "needle", intent: "chat" },
    ]) {
      const response = await fetch(`${server.base}/api/search`, {
        method: "POST",
        headers: { "content-type": "application/json", ...server.browserHeaders },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json() as { code: string }).code, "INVALID_INPUT");
    }
    const decisionResponse = await fetch(`${server.base}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json", ...server.browserHeaders },
      body: JSON.stringify({ query: "方案", intent: "decision" }),
    });
    assert.equal(decisionResponse.status, 200);
  } finally {
    await server.close();
  }
});

test("HTTP maps stable source failures and preserves connector search metadata", async () => {
  const failures = new Map<string, KnowledgeErrorCode>([
    ["unauthorized", "UNAUTHORIZED"], ["stale", "SOURCE_STALE"], ["limited", "RATE_LIMITED"],
    ["upstream", "UPSTREAM_UNAVAILABLE"], ["timeout", "TIMEOUT"],
  ]);
  const source: KnowledgeSource = {
    descriptor: () => ({
      id: "typed-source", name: "Typed source", capabilities: ["read", "search"],
      searchMode: "source", searchDescription: "typed source search",
    }),
    search: async (query) => {
      const code = failures.get(query);
      if (code) throw new KnowledgeSourceError(code, `safe ${code}`);
      const results = [] as KnowledgeSearchResults;
      results.requestId = "connector-request-1";
      results.retrievalMode = "keyword";
      return results;
    },
  };
  const server = await apiServer(source);
  try {
    const headers = { "content-type": "application/json", ...server.browserHeaders };
    const expectedStatuses = new Map([
      ["unauthorized", 401], ["stale", 409], ["limited", 429],
      ["upstream", 502], ["timeout", 504],
    ]);
    for (const [query, status] of expectedStatuses) {
      const response = await fetch(`${server.base}/api/search`, {
        method: "POST", headers, body: JSON.stringify({ query, sourceId: "typed-source" }),
      });
      assert.equal(response.status, status);
      assert.equal((await response.json() as { code: string }).code, failures.get(query));
    }
    const response = await fetch(`${server.base}/api/search`, {
      method: "POST", headers, body: JSON.stringify({ query: "ok", sourceId: "typed-source" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { results: [], requestId: "connector-request-1", retrievalMode: "keyword" });
  } finally {
    await server.close();
  }
});

test("HTTP project routing isolates search and rejects cross-project source injection", async () => {
  const first = await mkdtemp(join(tmpdir(), "action-pocket-api-project-a-"));
  const second = await mkdtemp(join(tmpdir(), "action-pocket-api-project-b-"));
  await writeFile(join(first, "a.md"), "shared-project-query alpha-only");
  await writeFile(join(second, "b.md"), "shared-project-query beta-only");
  const config = {
    version: 1,
    projects: [
      { id: "project-a", name: "A", defaultSourceId: "source-a", sources: [{ id: "source-a", kind: "markdown-files", scope: { kind: "directory", path: first } }] },
      { id: "project-b", name: "B", defaultSourceId: "source-b", sources: [{ id: "source-b", kind: "markdown-files", scope: { kind: "directory", path: second } }] },
    ],
  };
  const registry = await registryFromEnvironment({ AP_PROJECTS_JSON: JSON.stringify(config) });
  const server = await apiServer(undefined, async () => {}, registry);
  try {
    const headers = { "content-type": "application/json", ...server.browserHeaders };
    const search = async (body: object) => fetch(`${server.base}/api/search`, { method: "POST", headers, body: JSON.stringify({ query: "shared project query", ...body }) });
    let response = await search({ projectId: "project-a", sourceId: "source-a" });
    assert.equal((await response.json() as { results: Array<{ location: { path: string } }> }).results[0].location.path, "a.md");
    response = await search({ projectId: "project-b", sourceId: "source-b" });
    assert.equal((await response.json() as { results: Array<{ location: { path: string } }> }).results[0].location.path, "b.md");
    response = await search({ projectId: "project-a", sourceId: "source-b" });
    assert.equal(response.status, 404);
    response = await search({});
    assert.equal(response.status, 400);
  } finally { await server.close(); }
});

test("HTTP locate opens only a source-validated result path without accepting absolute paths", async () => {
  let revealed = "";
  const server = await apiServer(undefined, async (path) => { revealed = path; });
  try {
    const headers = { "content-type": "application/json", ...server.browserHeaders };
    await fetch(`${server.base}/api/write`, {
      method: "POST", headers, body: JSON.stringify({ rawContent: "locate", target: { sourceId: "file-graph", relativePath: "safe.md" } }),
    });
    const projects = await (await fetch(`${server.base}/api/projects`, { headers: server.browserHeaders })).json() as { projects: Array<{ id: string }> };
    await fetch(`${server.base}/api/write`, {
      method: "POST", headers, body: JSON.stringify({ rawContent: "not-returned", target: { sourceId: "file-graph", relativePath: "other.md" } }),
    });
    await fetch(`${server.base}/api/search`, {
      method: "POST", headers, body: JSON.stringify({ query: "locate", projectId: projects.projects[0].id, sourceId: "file-graph" }),
    });
    let response = await fetch(`${server.base}/api/locate`, {
      method: "POST", headers, body: JSON.stringify({ projectId: projects.projects[0].id, sourceId: "file-graph", documentId: "safe.md" }),
    });
    assert.equal(response.status, 200);
    assert.equal(revealed.endsWith("safe.md"), true);
    response = await fetch(`${server.base}/api/locate`, {
      method: "POST", headers, body: JSON.stringify({ projectId: projects.projects[0].id, sourceId: "file-graph", documentId: "other.md" }),
    });
    assert.equal(response.status, 404);
    response = await fetch(`${server.base}/api/locate`, {
      method: "POST", headers, body: JSON.stringify({ projectId: projects.projects[0].id, sourceId: "file-graph", documentId: "/tmp/unsafe.md" }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "INVALID_INPUT");
  } finally { await server.close(); }
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
