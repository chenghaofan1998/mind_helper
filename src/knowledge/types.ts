export type Capability = "read" | "search" | "write" | "locate" | "status";

export interface SourceDescriptor {
  id: string;
  name: string;
  projectId?: string;
  capabilities: Capability[];
  searchMode: "source" | "lexical-fallback";
  searchDescription: string;
  defaultWritePath?: string;
}

export interface ProjectDescriptor {
  id: string;
  name: string;
  sourceIds: string[];
  defaultSourceId: string;
}

export interface SourceLocation {
  sourceId: string;
  documentId: string;
  path: string;
  line?: number;
  blockId?: string;
  uri?: string;
  version?: string;
}

export type KnowledgeResultKind = "command" | "understanding" | "note" | "task" | "decision";
export type SearchIntent = "find" | "command" | "understanding" | "task" | "decision";
export type RetrievalMode = "rag" | "hybrid" | "keyword";

export interface KnowledgeResult {
  id: string;
  title: string;
  excerpt: string;
  contextBefore?: string;
  contextAfter?: string;
  kind: KnowledgeResultKind;
  location: SourceLocation;
  score?: number;
  retrievalMode?: RetrievalMode;
}

/** Array-compatible search output with optional connector envelope metadata. */
export interface KnowledgeSearchResults extends Array<KnowledgeResult> {
  requestId?: string;
  retrievalMode?: RetrievalMode;
}

export interface SearchInput {
  query: string;
  projectId?: string;
  sourceId?: string;
  limit?: number;
  intent?: SearchIntent;
}

export interface WriteInput {
  rawContent: string;
  projectId?: string;
  target: {
    sourceId: string;
    relativePath: string;
  };
}

export interface WriteSuccess {
  ok: true;
  location: SourceLocation;
  version: string;
}

export type KnowledgeErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "NOT_CONFIGURED"
  | "NOT_FOUND"
  | "CAPABILITY_UNAVAILABLE"
  | "PATH_OUTSIDE_SOURCE"
  | "FORBIDDEN"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "SOURCE_STALE"
  | "UPSTREAM_UNAVAILABLE"
  | "IO_ERROR"
  | "TIMEOUT";

export interface WriteFailure {
  ok: false;
  code: KnowledgeErrorCode;
  message: string;
}

export type WriteReceipt = WriteSuccess | WriteFailure;

export interface PinnedResult {
  location: SourceLocation;
  pinnedAt: string;
  sourceVersion?: string;
}

export interface UsefulFeedback {
  location: SourceLocation;
  value: "useful" | "not-useful";
  at: string;
}

export interface LocatedDocument {
  absolutePath: string;
}

export interface LocateInput {
  projectId: string;
  sourceId: string;
  documentId: string;
}

export interface KnowledgeSource {
  descriptor(): SourceDescriptor;
  search(query: string, limit: number, signal?: AbortSignal, intent?: SearchIntent): Promise<KnowledgeSearchResults>;
  write?(input: WriteInput): Promise<WriteReceipt>;
  locate?(documentId: string): Promise<LocatedDocument>;
}

export interface SourcesResponse { sources: SourceDescriptor[]; }
export interface ProjectsResponse { projects: ProjectDescriptor[]; activeProjectId?: string; }
export interface SearchResponse {
  results: KnowledgeResult[];
  requestId?: string;
  retrievalMode?: RetrievalMode;
}
