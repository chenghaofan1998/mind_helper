import type {
  KnowledgeErrorCode,
  KnowledgeSearchResults,
  LocateInput,
  ProjectDescriptor,
  ProjectsResponse,
  SearchInput,
  SearchResponse,
  SourceDescriptor,
  SourcesResponse,
  WriteInput,
  WriteReceipt,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 8_000;
const SESSION_TOKEN_META = "action-pocket-session-token";

function sessionToken(): string {
  return document.querySelector<HTMLMetaElement>(`meta[name="${SESSION_TOKEN_META}"]`)?.content ?? "";
}

export class KnowledgeClientError extends Error {
  constructor(
    message: string,
    public readonly code: KnowledgeErrorCode = "IO_ERROR",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "KnowledgeClientError";
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Action-Pocket-Token": sessionToken(),
        ...init.headers,
      },
    });
    const body = await response.json().catch(() => ({})) as Partial<KnowledgeClientError> & T;
    if (!response.ok) {
      throw new KnowledgeClientError(
        typeof body.message === "string" ? body.message : `请求失败（${response.status}）`,
        body.code ?? "IO_ERROR",
        response.status,
      );
    }
    return body;
  } catch (error) {
    if (error instanceof KnowledgeClientError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new KnowledgeClientError("知识源响应超时，请稍后重试。", "TIMEOUT");
    }
    throw new KnowledgeClientError(error instanceof Error ? error.message : "无法连接本地知识源。", "IO_ERROR");
  } finally {
    window.clearTimeout(timer);
  }
}

export async function listSources(): Promise<SourceDescriptor[]> {
  return (await requestJson<SourcesResponse>("/api/sources")).sources;
}

export async function listProjects(): Promise<{ projects: ProjectDescriptor[]; activeProjectId?: string }> {
  return requestJson<ProjectsResponse>("/api/projects");
}

export async function locateKnowledge(input: LocateInput): Promise<void> {
  await requestJson<{ ok: true }>("/api/locate", { method: "POST", body: JSON.stringify(input) });
}

export async function searchKnowledge(input: SearchInput): Promise<KnowledgeSearchResults> {
  const response = await requestJson<SearchResponse>("/api/search", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const results = response.results as KnowledgeSearchResults;
  results.requestId = response.requestId;
  results.retrievalMode = response.retrievalMode;
  return results;
}

export async function writeKnowledge(input: WriteInput): Promise<WriteReceipt> {
  try {
    return await requestJson<WriteReceipt>("/api/write", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof KnowledgeClientError && error.status) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}
