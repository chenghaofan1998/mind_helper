import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SearchIntent, WriteInput } from "../src/knowledge/types.js";
import { KnowledgeSourceError, publicError } from "./errors.js";
import type { SourceRegistry } from "./sourceRegistry.js";

const MAX_JSON_BYTES = 300 * 1024;
const SEARCH_INTENTS = new Set<SearchIntent>(["find", "command", "understanding", "task", "decision"]);

type Next = (error?: unknown) => void;

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BYTES) throw new KnowledgeSourceError("PAYLOAD_TOO_LARGE", "请求体不能超过 300 KiB。");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new KnowledgeSourceError("INVALID_INPUT", "请求体必须是有效 JSON。");
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new KnowledgeSourceError("INVALID_INPUT", "请求字段无效。");
  }
  return value as Record<string, unknown>;
}

function errorStatus(code: string): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "CAPABILITY_UNAVAILABLE" || code === "SOURCE_STALE") return 409;
  if (code === "PAYLOAD_TOO_LARGE") return 413;
  if (code === "UNSUPPORTED_MEDIA_TYPE") return 415;
  if (code === "RATE_LIMITED") return 429;
  if (code === "IO_ERROR") return 500;
  if (code === "UPSTREAM_UNAVAILABLE") return 502;
  if (code === "NOT_CONFIGURED") return 503;
  if (code === "TIMEOUT") return 504;
  return 400;
}

function tokenMatches(candidate: string | string[] | undefined, expected: string): boolean {
  if (typeof candidate !== "string") return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

function assertAuthorizedRequest(request: IncomingMessage, sessionToken: string): void {
  if (!sessionToken || !tokenMatches(request.headers["x-action-pocket-token"], sessionToken)) {
    throw new KnowledgeSourceError("FORBIDDEN", "知识源 API 需要当前开发会话凭据。");
  }
  const origin = request.headers.origin;
  if (origin === undefined) return; // Non-browser clients authenticate with the session token.
  try {
    if (typeof origin !== "string") throw new Error("invalid origin");
    const originUrl = new URL(origin);
    const requestHost = request.headers.host ?? "";
    if (originUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(originUrl.hostname) || originUrl.host !== requestHost) {
      throw new Error("cross origin");
    }
  } catch {
    throw new KnowledgeSourceError("FORBIDDEN", "知识源 API 只接受同源本机页面请求。");
  }
}

function assertJsonRequest(request: IncomingMessage): void {
  const contentType = request.headers["content-type"] ?? "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new KnowledgeSourceError("UNSUPPORTED_MEDIA_TYPE", "写入和查询 API 只接受 application/json。");
  }
}

export function createApiMiddleware(registryPromise: Promise<SourceRegistry>, sessionToken: string) {
  return async (request: IncomingMessage, response: ServerResponse, next: Next): Promise<void> => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (!pathname.startsWith("/api/")) return next();
    try {
      assertAuthorizedRequest(request, sessionToken);
      const registry = await registryPromise;
      if (request.method === "GET" && pathname === "/api/sources") {
        send(response, 200, { sources: registry.descriptors() });
        return;
      }
      if (request.method !== "POST") throw new KnowledgeSourceError("NOT_FOUND", "API 路径不存在。");
      if (pathname !== "/api/search" && pathname !== "/api/write") {
        throw new KnowledgeSourceError("NOT_FOUND", "API 路径不存在。");
      }
      assertJsonRequest(request);
      const body = objectBody(await readJson(request));
      if (pathname === "/api/search") {
        if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 500) {
          throw new KnowledgeSourceError("INVALID_INPUT", "查询内容必须为 1–500 个字符。");
        }
        if (Object.hasOwn(body, "sourceId") && typeof body.sourceId !== "string") {
          throw new KnowledgeSourceError("INVALID_INPUT", "sourceId 必须是字符串。");
        }
        if (Object.hasOwn(body, "limit") && (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 5)) {
          throw new KnowledgeSourceError("INVALID_INPUT", "limit 必须是 1–5 的整数。");
        }
        if (Object.hasOwn(body, "intent") && (typeof body.intent !== "string" || !SEARCH_INTENTS.has(body.intent as SearchIntent))) {
          throw new KnowledgeSourceError("INVALID_INPUT", "intent 必须是 find、command、understanding、task 或 decision。");
        }
        const sourceId = body.sourceId as string | undefined ?? registry.descriptors().find((source) => source.capabilities.includes("search"))?.id;
        const limit = body.limit as number | undefined ?? 5;
        if (!sourceId) throw new KnowledgeSourceError("NOT_CONFIGURED", "尚未连接可检索的知识源。");
        const source = registry.require(sourceId, "search");
        const controller = new AbortController();
        const abort = () => controller.abort();
        const abortOnClose = () => { if (!response.writableEnded) abort(); };
        request.once("aborted", abort);
        response.once("close", abortOnClose);
        try {
          const results = await source.search(body.query, limit, controller.signal, body.intent as SearchIntent | undefined);
          send(response, 200, {
            results,
            ...(results.requestId ? { requestId: results.requestId } : {}),
            ...(results.retrievalMode ? { retrievalMode: results.retrievalMode } : {}),
          });
        } finally {
          request.off("aborted", abort);
          response.off("close", abortOnClose);
        }
        return;
      }
      if (pathname === "/api/write") {
        const input = body as unknown as WriteInput;
        if (typeof input.rawContent !== "string" || !input.target || typeof input.target.sourceId !== "string" || typeof input.target.relativePath !== "string") {
          throw new KnowledgeSourceError("INVALID_INPUT", "写入内容、知识源和相对路径均为必填项。");
        }
        const source = registry.require(input.target.sourceId, "write");
        const receipt = await source.write!(input);
        send(response, receipt.ok ? 200 : errorStatus(receipt.code), receipt);
        return;
      }
      throw new KnowledgeSourceError("NOT_FOUND", "API 路径不存在。");
    } catch (error) {
      const exposed = publicError(error);
      send(response, errorStatus(exposed.code), { ok: false, ...exposed });
    }
  };
}
