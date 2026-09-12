import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { KnowledgeSourceError } from "../errors.js";
import { HttpConnectorSource } from "./httpConnector.js";

type RecordedRequest = { path: string; authorization?: string; body?: any };
type FixtureResponse = { status?: number; body: unknown } | null;
type FixtureHandler = (request: RecordedRequest) => FixtureResponse | Promise<FixtureResponse>;

const capabilitiesResponse = {
  requestId: "cap-1",
  source: { id: "remote", name: "Remote RAG", connectorType: "knowledge-source", defaultWriteTarget: "inbox" },
  capabilities: ["rag", "write", "locate"],
};
const searchResponse = {
  requestId: "search-1",
  retrievalMode: "rag",
  results: [{
    id: "r1", kind: "decision", evidence: { excerpt: "决策：先灰度发布", contextBefore: "计划" },
    location: { sourceId: "remote", documentId: "decisions", path: "plans/decisions.md", line: 8, version: "v2" },
    retrieval: { mode: "rag", score: 0.9 },
  }],
};
const writeResponse = {
  requestId: "write-1", ok: true,
  location: { sourceId: "remote", documentId: "inbox", path: "inbox", version: "v3" },
};

async function connectorServer(handler?: FixtureHandler) {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", async () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      const recorded = { path: request.url ?? "", authorization: request.headers.authorization, body };
      requests.push(recorded);
      let fixtureResponse = handler ? await handler(recorded) : undefined;
      if (fixtureResponse === undefined) {
        if (request.url === "/action-pocket/v1/capabilities") fixtureResponse = { body: capabilitiesResponse };
        else if (request.url === "/action-pocket/v1/search") fixtureResponse = { body: searchResponse };
        else if (request.url === "/action-pocket/v1/write") fixtureResponse = { body: writeResponse };
        else fixtureResponse = { status: 404, body: { requestId: "missing", code: "NOT_FOUND", message: "missing" } };
      }
      if (fixtureResponse === null || response.destroyed) return;
      response.statusCode = fixtureResponse.status ?? 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(fixtureResponse.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing connector address");
  return {
    url: `http://127.0.0.1:${address.port}/action-pocket/v1`,
    requests,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

function isSourceError(code: string) {
  return (error: unknown) => error instanceof KnowledgeSourceError && error.code === code;
}

test("HTTP connector maps capabilities, intent search, source locations, retrieval envelope, and writes", async () => {
  const fixture = await connectorServer();
  try {
    const source = new HttpConnectorSource(fixture.url, "secret-token");
    await source.initialize();
    assert.deepEqual(source.descriptor(), {
      id: "connector:remote",
      name: "Remote RAG",
      capabilities: ["read", "search", "write", "locate"],
      searchMode: "source",
      searchDescription: "标准 HTTP Connector 提供的检索",
      defaultWritePath: "inbox",
    });

    const results = await source.search("发布", 5, undefined, "decision");
    assert.equal(results.requestId, "search-1");
    assert.equal(results.retrievalMode, "rag");
    assert.equal(results[0].retrievalMode, "rag");
    assert.equal(results[0].kind, "decision");
    assert.equal(results[0].location.sourceId, "connector:remote");
    assert.equal(results[0].location.path, "plans/decisions.md");
    assert.equal(fixture.requests[1].body.intent, "decision");

    const receipt = await source.write({ rawContent: "原始输入", target: { sourceId: "connector:remote", relativePath: "inbox" } });
    assert.equal(receipt.ok, true);
    assert.equal(fixture.requests[2].authorization, "Bearer secret-token");
    assert.equal(fixture.requests[2].body.input.content, "原始输入");
    assert.equal(fixture.requests[2].body.target.sourceId, "remote");
  } finally {
    await fixture.close();
  }
});

test("HTTP connector rejects missing capability envelope fields and invalid capability enums", async () => {
  const invalidResponses = [
    { ...capabilitiesResponse, requestId: undefined },
    { ...capabilitiesResponse, source: { ...capabilitiesResponse.source, connectorType: "database" } },
    { ...capabilitiesResponse, capabilities: ["rag", "unknown-capability"] },
  ];
  for (const body of invalidResponses) {
    const fixture = await connectorServer((request) => request.path.endsWith("/capabilities") ? { body } : undefined as never);
    try {
      await assert.rejects(new HttpConnectorSource(fixture.url).initialize(), isSourceError("IO_ERROR"));
    } finally {
      await fixture.close();
    }
  }
});

test("HTTP connector rejects missing search envelope fields and invalid retrieval enums", async () => {
  const searchBodies: Record<string, unknown> = {
    "missing-request": { ...searchResponse, requestId: undefined },
    "missing-mode": { ...searchResponse, retrievalMode: undefined },
    "missing-result-retrieval": { ...searchResponse, results: [{ ...searchResponse.results[0], retrieval: undefined }] },
    "invalid-top-mode": { ...searchResponse, retrievalMode: "semantic" },
    "invalid-result-mode": { ...searchResponse, results: [{ ...searchResponse.results[0], retrieval: { mode: "semantic" } }] },
  };
  const fixture = await connectorServer((request) => {
    if (request.path.endsWith("/search")) return { body: searchBodies[request.body.query] };
    return undefined as never;
  });
  try {
    const source = new HttpConnectorSource(fixture.url);
    await source.initialize();
    for (const query of Object.keys(searchBodies)) {
      await assert.rejects(source.search(query, 5), isSourceError("IO_ERROR"));
    }
  } finally {
    await fixture.close();
  }
});

test("HTTP connector rejects missing or unsuccessful write envelope fields", async () => {
  const writeBodies = [
    { ...writeResponse, requestId: undefined },
    { ...writeResponse, ok: undefined },
    { ...writeResponse, ok: false },
  ];
  let writeIndex = 0;
  const fixture = await connectorServer((request) => {
    if (request.path.endsWith("/write")) return { body: writeBodies[writeIndex++] };
    return undefined as never;
  });
  try {
    const source = new HttpConnectorSource(fixture.url);
    await source.initialize();
    for (const _body of writeBodies) {
      const receipt = await source.write({ rawContent: "原文", target: { sourceId: "connector:remote", relativePath: "inbox" } });
      assert.equal(receipt.ok, false);
      if (!receipt.ok) assert.equal(receipt.code, "IO_ERROR");
    }
  } finally {
    await fixture.close();
  }
});

test("HTTP connector preserves allowlisted upstream error codes and rejects unknown codes", async () => {
  const failures: Record<string, { status: number; code: string }> = {
    missing: { status: 404, code: "NOT_FOUND" },
    unavailable: { status: 409, code: "CAPABILITY_UNAVAILABLE" },
    large: { status: 413, code: "PAYLOAD_TOO_LARGE" },
    limited: { status: 429, code: "RATE_LIMITED" },
    stale: { status: 409, code: "SOURCE_STALE" },
    timeout: { status: 504, code: "TIMEOUT" },
    upstream: { status: 503, code: "UPSTREAM_UNAVAILABLE" },
    unauthorized: { status: 401, code: "UNAUTHORIZED" },
  };
  const fixture = await connectorServer((request) => {
    if (!request.path.endsWith("/search")) return undefined as never;
    if (request.body.query === "unknown") {
      return { status: 418, body: { requestId: "error-unknown", code: "VENDOR_PRIVATE", message: "must not escape" } };
    }
    const failure = failures[request.body.query];
    return { status: failure.status, body: { requestId: `error-${request.body.query}`, code: failure.code, message: `safe ${failure.code}` } };
  });
  try {
    const source = new HttpConnectorSource(fixture.url);
    await source.initialize();
    for (const [query, failure] of Object.entries(failures)) {
      await assert.rejects(source.search(query, 5), isSourceError(failure.code));
    }
    await assert.rejects(source.search("unknown", 5), isSourceError("IO_ERROR"));
  } finally {
    await fixture.close();
  }
});

test("HTTP connector does not send a pre-cancelled search request", async () => {
  const fixture = await connectorServer();
  try {
    const source = new HttpConnectorSource(fixture.url);
    await source.initialize();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(source.search("must-not-send", 5, controller.signal), isSourceError("TIMEOUT"));
    assert.equal(fixture.requests.filter((request) => request.path.endsWith("/search")).length, 0);
  } finally {
    await fixture.close();
  }
});

test("HTTP connector aborts an in-progress search", async () => {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const fixture = await connectorServer((request) => {
    if (request.path.endsWith("/search")) {
      markStarted();
      return null;
    }
    return undefined as never;
  });
  try {
    const source = new HttpConnectorSource(fixture.url);
    await source.initialize();
    const controller = new AbortController();
    const pending = source.search("cancel-in-progress", 5, controller.signal);
    await started;
    controller.abort();
    await assert.rejects(pending, isSourceError("TIMEOUT"));
    assert.equal(fixture.requests.filter((request) => request.path.endsWith("/search")).length, 1);
  } finally {
    await fixture.close();
  }
});

test("HTTP connector rejects non-loopback plaintext URLs and URL credentials", () => {
  assert.throws(() => new HttpConnectorSource("http://example.com/action-pocket/v1"), /HTTPS/);
  assert.throws(() => new HttpConnectorSource("https://user:pass@example.com/action-pocket/v1"), /不能包含凭据/);
});
