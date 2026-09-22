import { extname, isAbsolute, relative, sep } from "node:path";
import { KnowledgeSourceError } from "../errors.js";

export const OMITTED_DIRECTORIES = new Set([
  ".git", ".cache", ".pytest_cache", ".venv", "node_modules", "__pycache__", "coverage", "dist", "build",
]);

const SEARCHABLE_EXTENSIONS = new Set([
  ".md", ".markdown", ".txt", ".html", ".htm", ".css", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
  ".json", ".jsonl", ".yaml", ".yml", ".toml", ".xml", ".py", ".go", ".rs", ".java", ".cs", ".c", ".h",
  ".cpp", ".hpp", ".sh", ".ps1", ".sql", ".edn",
]);

export function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

export function isSearchableFile(path: string): boolean {
  return SEARCHABLE_EXTENSIONS.has(extname(path).toLowerCase());
}

type FileIdentity = { dev: number | bigint; ino: number | bigint };

/** Windows mounted/network filesystems can report different file IDs for a handle and its path. */
export function fileIdentityMatches(opened: FileIdentity, resolved: FileIdentity, platform = process.platform): boolean {
  if (platform === "win32" || opened.ino === 0 || opened.ino === 0n || resolved.ino === 0 || resolved.ino === 0n) return true;
  return opened.dev === resolved.dev && opened.ino === resolved.ino;
}

function validateSafeRelativePath(value: string): string {
  const path = value.trim().replaceAll("\\", "/");
  if (!path || path.length > 240 || path.startsWith("/") || /^[a-z]:/i.test(path)) {
    throw new KnowledgeSourceError("INVALID_INPUT", "文件位置必须是知识源内的安全相对路径。");
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) {
    throw new KnowledgeSourceError("PATH_OUTSIDE_SOURCE", "文件位置不能包含空段、. 或 ..。");
  }
  return parts.join("/");
}

export function validateWritePath(value: string): string {
  const path = validateSafeRelativePath(value);
  if (![".md", ".markdown"].includes(extname(path).toLowerCase())) {
    throw new KnowledgeSourceError("INVALID_INPUT", "文件型知识源只写入 .md 或 .markdown 文件。");
  }
  return path;
}

export function assertWritableOutsidePipeline(absolutePath: string): void {
  const parts = absolutePath.replaceAll("\\", "/").toLowerCase().split("/");
  const protectedEntries = new Set(["30-summaries", "40-review", "50-knowledge", "ai knowledge index.md"]);
  if (parts.some((part, index) => part === "knowledge-pipeline" && protectedEntries.has(parts[index + 1]))) {
    throw new KnowledgeSourceError("FORBIDDEN", "知识管线产物由加工引擎管理，请写入 journals 等非管线目录。");
  }
}

export function validateDocumentPath(value: string): string {
  const path = validateSafeRelativePath(value);
  if (!isSearchableFile(path)) throw new KnowledgeSourceError("INVALID_INPUT", "原文不是受支持的文本文件。");
  return path;
}
