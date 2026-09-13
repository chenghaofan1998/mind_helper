import type { KnowledgeErrorCode } from "../src/knowledge/types.js";

export class KnowledgeSourceError extends Error {
  constructor(public readonly code: KnowledgeErrorCode, message: string) {
    super(message);
    this.name = "KnowledgeSourceError";
  }
}

export function publicError(error: unknown): { code: KnowledgeErrorCode; message: string } {
  if (error instanceof KnowledgeSourceError) return { code: error.code, message: error.message };
  return { code: "IO_ERROR", message: "知识源读写失败，请检查目录权限与配置。" };
}
