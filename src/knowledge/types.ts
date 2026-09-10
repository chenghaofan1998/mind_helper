export type Capability = "read" | "search" | "write" | "locate" | "status";

export interface SourceDescriptor {
  id: string;
  name: string;
  capabilities: Capability[];
  searchMode: "source" | "lexical-fallback";
  searchDescription: string;
  defaultWritePath?: string;
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

export type KnowledgeResultKind = "command" | "understanding" | "note";

export interface KnowledgeResult {
  id: string;
  title: string;
  excerpt: string;
  contextBefore?: string;
  contextAfter?: string;
  kind: KnowledgeResultKind;
  location: SourceLocation;
  score?: number;
}

export interface SearchInput {
  query: string;
  sourceId?: string;
  limit?: number;
}

export interface WriteInput {
  rawContent: string;
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
  | "NOT_CONFIGURED"
  | "NOT_FOUND"
  | "CAPABILITY_UNAVAILABLE"
  | "PATH_OUTSIDE_SOURCE"
  | "FORBIDDEN"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
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

export interface KnowledgeSource {
  descriptor(): SourceDescriptor;
  search(query: string, limit: number, signal?: AbortSignal): Promise<KnowledgeResult[]>;
  write?(input: WriteInput): Promise<WriteReceipt>;
}

export interface SourcesResponse { sources: SourceDescriptor[]; }
export interface SearchResponse { results: KnowledgeResult[]; }
