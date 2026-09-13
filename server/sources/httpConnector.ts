import { randomUUID } from "node:crypto";
import type {
  Capability,
  KnowledgeErrorCode,
  KnowledgeResult,
  KnowledgeResultKind,
  KnowledgeSearchResults,
  KnowledgeSource,
  RetrievalMode,
  SearchIntent,
  SourceDescriptor,
  SourceLocation,
  WriteInput,
  WriteReceipt,
} from "../../src/knowledge/types.js";
import { KnowledgeSourceError, publicError } from "../errors.js";

const RESPONSE_LIMIT = 2 * 1024 * 1024;
// Keep the upstream budget below the UI's 8 s deadline so typed errors can propagate.
const REQUEST_TIMEOUT = 7_000;
const RESULT_KINDS = new Set<KnowledgeResultKind>(["command", "understanding", "note", "task", "decision"]);
const RETRIEVAL_MODES = new Set<RetrievalMode>(["rag", "hybrid", "keyword"]);
const CONNECTOR_TYPES = new Set(["knowledge-source", "multimodal-analyzer", "combined"]);
const CONNECTOR_CAPABILITIES = new Set(["search", "rag", "write", "locate", "status", "vision-analysis", "multimodal-input", "observe"]);
const CONNECTOR_ERROR_CODES = new Set<KnowledgeErrorCode>([
  "INVALID_INPUT", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CAPABILITY_UNAVAILABLE",
  "PAYLOAD_TOO_LARGE", "RATE_LIMITED", "SOURCE_STALE", "TIMEOUT", "UPSTREAM_UNAVAILABLE", "IO_ERROR",
]);

function objectValue(value: unknown, message = "Connector 返回了无效响应。"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KnowledgeSourceError("IO_ERROR", message);
  return value as Record<string, unknown>;
}

function requiredString(value: Record<string, unknown>, key: string, message: string): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || !candidate.trim()) throw new KnowledgeSourceError("IO_ERROR", message);
  return candidate;
}

function requestId(value: Record<string, unknown>): string {
  return requiredString(value, "requestId", "Connector 响应缺少 requestId。");
}

function retrievalMode(value: unknown, message: string): RetrievalMode {
  if (typeof value !== "string" || !RETRIEVAL_MODES.has(value as RetrievalMode)) {
    throw new KnowledgeSourceError("IO_ERROR", message);
  }
  return value as RetrievalMode;
}

function connectorBase(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new KnowledgeSourceError("NOT_CONFIGURED", "AP_CONNECTOR_URL 必须是有效 URL。"); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new KnowledgeSourceError("NOT_CONFIGURED", "Connector 必须使用 HTTPS；仅回环地址可使用 HTTP。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new KnowledgeSourceError("NOT_CONFIGURED", "Connector URL 不能包含凭据、查询参数或片段。");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

function mappedCapabilities(values: unknown): Capability[] {
  if (!Array.isArray(values)) throw new KnowledgeSourceError("IO_ERROR", "Connector capabilities 无效。");
  const declared = new Set<string>();
  for (const item of values) {
    if (typeof item !== "string" || !CONNECTOR_CAPABILITIES.has(item) || declared.has(item)) {
      throw new KnowledgeSourceError("IO_ERROR", "Connector capabilities 包含无效或重复值。");
    }
    declared.add(item);
  }
  const capabilities: Capability[] = [];
  if (declared.has("search") || declared.has("rag")) capabilities.push("read", "search");
  if (declared.has("write")) capabilities.push("write");
  if (declared.has("locate")) capabilities.push("locate");
  if (declared.has("status")) capabilities.push("status");
  return capabilities;
}

function mappedLocation(value: unknown, sourceId: string): SourceLocation {
  const location = objectValue(value, "Connector location 无效。");
  if (typeof location.sourceId !== "string" || !location.sourceId.trim()
    || typeof location.documentId !== "string" || !location.documentId.trim()
    || typeof location.version !== "string" || !location.version.trim()) {
    throw new KnowledgeSourceError("IO_ERROR", "Connector location 缺少 sourceId、documentId 或 version。");
  }
  if (location.line !== undefined && (typeof location.line !== "number" || !Number.isInteger(location.line) || location.line < 1)) {
    throw new KnowledgeSourceError("IO_ERROR", "Connector location.line 无效。");
  }
  return {
    sourceId,
    documentId: location.documentId,
    path: typeof location.path === "string" ? location.path : location.documentId,
    line: location.line as number | undefined,
    blockId: typeof location.blockId === "string" ? location.blockId : undefined,
    uri: typeof location.uri === "string" ? location.uri : undefined,
    version: location.version,
  };
}

function mappedResult(value: unknown, sourceId: string): KnowledgeResult {
  const result = objectValue(value, "Connector result 无效。");
  const evidence = objectValue(result.evidence, "Connector evidence 无效。");
  if (typeof result.id !== "string" || !result.id.trim() || typeof evidence.excerpt !== "string") {
    throw new KnowledgeSourceError("IO_ERROR", "Connector result 缺少 id 或 evidence.excerpt。");
  }
  const location = mappedLocation(result.location, sourceId);
  if (result.kind !== undefined && (typeof result.kind !== "string" || !RESULT_KINDS.has(result.kind as KnowledgeResultKind))) {
    throw new KnowledgeSourceError("IO_ERROR", "Connector result.kind 无效。");
  }
  const kind = result.kind as KnowledgeResultKind | undefined ?? "note";
  const retrieval = objectValue(result.retrieval, "Connector result 缺少 retrieval。");
  const mode = retrievalMode(retrieval.mode, "Connector retrieval.mode 无效。");
  if (retrieval.score !== undefined && (typeof retrieval.score !== "number" || !Number.isFinite(retrieval.score))) {
    throw new KnowledgeSourceError("IO_ERROR", "Connector retrieval.score 无效。");
  }
  return {
    id: result.id,
    title: location.path || evidence.excerpt.slice(0, 48),
    excerpt: evidence.excerpt,
    contextBefore: typeof evidence.contextBefore === "string" ? evidence.contextBefore : undefined,
    contextAfter: typeof evidence.contextAfter === "string" ? evidence.contextAfter : undefined,
    kind,
    location,
    score: retrieval.score as number | undefined,
    retrievalMode: mode,
  };
}

function fallbackErrorCode(status: number): KnowledgeErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 413) return "PAYLOAD_TOO_LARGE";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502 || status === 503) return "UPSTREAM_UNAVAILABLE";
  return "IO_ERROR";
}

function connectorError(value: unknown, status: number): KnowledgeSourceError {
  let payload: Record<string, unknown>;
  try {
    payload = objectValue(value, "Connector 错误响应无效。");
    requestId(payload);
  } catch {
    return new KnowledgeSourceError(fallbackErrorCode(status), `Connector 请求失败（HTTP ${status}），且错误响应不符合契约。`);
  }
  if (typeof payload.code !== "string" || !CONNECTOR_ERROR_CODES.has(payload.code as KnowledgeErrorCode)
    || typeof payload.message !== "string" || !payload.message.trim()) {
    return new KnowledgeSourceError(fallbackErrorCode(status), `Connector 请求失败（HTTP ${status}），且错误响应不符合契约。`);
  }
  return new KnowledgeSourceError(payload.code as KnowledgeErrorCode, payload.message);
}

async function boundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > RESPONSE_LIMIT) {
    throw new KnowledgeSourceError("IO_ERROR", "Connector 响应超过 2 MiB。");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT) {
        await reader.cancel();
        throw new KnowledgeSourceError("IO_ERROR", "Connector 响应超过 2 MiB。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function parsedJson(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new KnowledgeSourceError("IO_ERROR", "Connector 返回的不是有效 JSON。"); }
}

export class HttpConnectorSource implements KnowledgeSource {
  private readonly base: URL;
  private descriptorValue?: SourceDescriptor;
  private upstreamSourceId = "";

  constructor(url: string, private readonly token?: string) {
    this.base = connectorBase(url);
  }

  async initialize(): Promise<void> {
    const payload = objectValue(await this.request("capabilities"));
    requestId(payload);
    const source = objectValue(payload.source, "Connector source descriptor 无效。");
    const sourceId = requiredString(source, "id", "Connector source 缺少 id 或 name。");
    const sourceName = requiredString(source, "name", "Connector source 缺少 id 或 name。");
    if (typeof source.connectorType !== "string" || !CONNECTOR_TYPES.has(source.connectorType)) {
      throw new KnowledgeSourceError("IO_ERROR", "Connector source.connectorType 无效。");
    }
    this.upstreamSourceId = sourceId;
    this.descriptorValue = {
      id: `connector:${sourceId}`,
      name: sourceName,
      capabilities: mappedCapabilities(payload.capabilities),
      searchMode: "source",
      searchDescription: "标准 HTTP Connector 提供的检索",
      defaultWritePath: typeof source.defaultWriteTarget === "string" ? source.defaultWriteTarget : undefined,
    };
  }

  descriptor(): SourceDescriptor {
    if (!this.descriptorValue) throw new Error("HTTP connector is not initialized");
    return this.descriptorValue;
  }

  async search(query: string, limit: number, signal?: AbortSignal, intent?: SearchIntent): Promise<KnowledgeSearchResults> {
    const payload = objectValue(await this.request("search", { query, limit, intent: intent ?? "find" }, signal));
    const responseRequestId = requestId(payload);
    const responseRetrievalMode = retrievalMode(payload.retrievalMode, "Connector retrievalMode 无效。");
    if (!Array.isArray(payload.results)) throw new KnowledgeSourceError("IO_ERROR", "Connector search results 无效。");
    const results = payload.results.slice(0, limit).map((result) => mappedResult(result, this.descriptor().id)) as KnowledgeSearchResults;
    results.requestId = responseRequestId;
    results.retrievalMode = responseRetrievalMode;
    return results;
  }

  async write(input: WriteInput): Promise<WriteReceipt> {
    try {
      const body = {
        input: {
          id: randomUUID(), modality: "text", intent: "capture", content: input.rawContent,
          capturedAt: new Date().toISOString(), consent: { explicit: true, scope: "write selected text" },
        },
        target: { sourceId: this.upstreamSourceId, location: input.target.relativePath },
      };
      const payload = objectValue(await this.request("write", body, undefined, randomUUID()));
      requestId(payload);
      if (payload.ok !== true) throw new KnowledgeSourceError("IO_ERROR", "Connector write 响应缺少 ok: true。");
      const location = mappedLocation(payload.location, this.descriptor().id);
      return { ok: true, location, version: location.version ?? "unknown" };
    } catch (error) {
      return { ok: false, ...publicError(error) };
    }
  }

  private async request(path: string, body?: unknown, signal?: AbortSignal, idempotencyKey?: string): Promise<unknown> {
    if (signal?.aborted) throw new KnowledgeSourceError("TIMEOUT", "Connector 请求超时或已取消。");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const response = await fetch(new URL(`${this.base.pathname}/${path}`, this.base), {
        method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
      });
      const text = await boundedResponseText(response);
      const payload = parsedJson(text);
      if (!response.ok) throw connectorError(payload, response.status);
      return payload;
    } catch (error) {
      if ((error as Error).name === "AbortError") throw new KnowledgeSourceError("TIMEOUT", "Connector 请求超时或已取消。");
      if (error instanceof KnowledgeSourceError) throw error;
      throw new KnowledgeSourceError("IO_ERROR", "无法连接知识源 Connector。");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}
