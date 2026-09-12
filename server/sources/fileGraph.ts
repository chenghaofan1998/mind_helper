import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { open, lstat, mkdir, opendir, realpath, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  KnowledgeResult,
  KnowledgeResultKind,
  KnowledgeSource,
  SearchIntent,
  SourceDescriptor,
  SourceLocation,
  WriteInput,
  WriteReceipt,
} from "../../src/knowledge/types.js";
import { KnowledgeSourceError, publicError } from "../errors.js";
import { withCrossProcessLock } from "./fileLock.js";

const MAX_WRITE_BYTES = 256 * 1024;
const MAX_SEARCH_QUERY = 500;
export const FILE_GRAPH_SEARCH_LIMITS = Object.freeze({
  maximumFileBytes: 2 * 1024 * 1024,
  maximumTotalBytes: 32 * 1024 * 1024,
  maximumFiles: 1_000,
  maximumDirectories: 1_000,
  maximumDirectoryEntries: 20_000,
  maximumBlocks: 50_000,
});
const MAX_FILE_BYTES = FILE_GRAPH_SEARCH_LIMITS.maximumFileBytes;
const MAX_TOTAL_SEARCH_BYTES = FILE_GRAPH_SEARCH_LIMITS.maximumTotalBytes;
const MAX_FILES = FILE_GRAPH_SEARCH_LIMITS.maximumFiles;
const MAX_DIRECTORIES = FILE_GRAPH_SEARCH_LIMITS.maximumDirectories;
const MAX_DIRECTORY_ENTRIES = FILE_GRAPH_SEARCH_LIMITS.maximumDirectoryEntries;
const MAX_BLOCKS = FILE_GRAPH_SEARCH_LIMITS.maximumBlocks;
const READ_CHUNK_BYTES = 64 * 1024;
const OMITTED_DIRECTORIES = new Set([".git", ".cache", "node_modules"]);
const writeQueues = new Map<string, Promise<void>>();

export interface FileGraphScope { kind: "directory" | "file"; path: string; }
interface TextBlock { text: string; line: number; title?: string; kind: KnowledgeResultKind; }
interface IndexedDocument { path: string; version: string; bytes: number; blocks: TextBlock[]; }
interface TraversalState { files: string[]; directories: number; entries: number; stopped: boolean; }

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

function validateRelativePath(value: string): string {
  const path = value.trim().replaceAll("\\", "/");
  if (!path || path.length > 240 || path.startsWith("/") || /^[a-z]:/i.test(path)) {
    throw new KnowledgeSourceError("INVALID_INPUT", "写入位置必须是知识源内的相对 Markdown 路径。");
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) {
    throw new KnowledgeSourceError("PATH_OUTSIDE_SOURCE", "写入位置不能包含空段、. 或 ..。");
  }
  if (![".md", ".markdown"].includes(extname(path).toLowerCase())) {
    throw new KnowledgeSourceError("INVALID_INPUT", "首个文件型知识源只写入 .md 或 .markdown 文件。");
  }
  return parts.join("/");
}

function lineKind(text: string): KnowledgeResultKind {
  const clean = text.replace(/^```[^\n]*\n?|```$/g, "").trim();
  if (/^(\$|>|PS>)?\s*(git|docker|kubectl|npm|pnpm|yarn|node|python|pip|find|grep|curl|ssh|sudo|rm|Remove-Item)\s+/i.test(clean) ||
      /^(select|insert|update|delete|drop|truncate)\s+/i.test(clean)) {
    return "command";
  }
  if (/^\s*[-*]\s+\[[ xX]\]|\bTODO\b|待办|未完成/i.test(clean)) return "task";
  if (/决策|取舍|权衡|方案对比|选择理由|利弊/i.test(clean)) return "decision";
  return /为什么|理解|概念|原理|means?|because|example|例如/i.test(clean) ? "understanding" : "note";
}

function matchesIntent(kind: KnowledgeResultKind, intent: SearchIntent | undefined): boolean {
  if (!intent || intent === "find") return true;
  return kind === intent;
}

export function parseMarkdown(content: string, maxBlocks = Number.POSITIVE_INFINITY): TextBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: TextBlock[] = [];
  let start = 0;
  let buffer: string[] = [];
  let heading = "";
  let fenced = false;

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text && blocks.length < maxBlocks) {
      blocks.push({ text, line: start + 1, title: heading || undefined, kind: lineKind(text) });
    }
    buffer = [];
  };

  for (let index = 0; index < lines.length && blocks.length < maxBlocks; index += 1) {
    const line = lines[index];
    const headingMatch = !fenced ? line.match(/^#{1,6}\s+(.+?)\s*#*$/) : null;
    if (headingMatch) {
      flush();
      heading = headingMatch[1];
      start = index;
      buffer = [line];
      flush();
    } else if (line.trim().startsWith("```")) {
      if (!buffer.length) start = index;
      buffer.push(line);
      fenced = !fenced;
      if (!fenced) flush();
    } else if (!fenced && !line.trim()) {
      flush();
    } else {
      if (!buffer.length) start = index;
      buffer.push(line);
    }
  }
  flush();
  return blocks;
}

function queryTerms(query: string): string[] {
  const normalized = query.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const segmented = [...new Intl.Segmenter("zh", { granularity: "word" }).segment(normalized)]
    .filter((item) => item.isWordLike)
    .map((item) => item.segment);
  return [...new Set([normalized, ...segmented].filter(Boolean))];
}

function scoreBlock(query: string, block: TextBlock, path: string): number {
  const [normalizedQuery, ...terms] = queryTerms(query);
  const title = (block.title ?? "").toLocaleLowerCase();
  const body = block.text.toLocaleLowerCase();
  const file = path.toLocaleLowerCase();
  let score = 0;
  if (title.includes(normalizedQuery)) score += 30;
  if (body.includes(normalizedQuery)) score += 20;
  if (file.includes(normalizedQuery)) score += 10;
  for (const term of terms) {
    if (title.includes(term)) score += 8;
    if (body.includes(term)) score += 4;
    if (file.includes(term)) score += 2;
  }
  return score;
}

function clipExcerpt(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}\n…（摘录已截断，请按来源定位查看原文）` : value;
}

function resultFromBlock(document: IndexedDocument, block: TextBlock, index: number, score: number, sourceId: string, root: string): KnowledgeResult {
  const blockHash = hash(block.text).slice(0, 16);
  const location: SourceLocation = {
    sourceId,
    documentId: document.path,
    path: document.path,
    line: block.line,
    uri: pathToFileURL(resolve(root, document.path)).href,
    blockId: blockHash,
    version: document.version,
  };
  return {
    id: `${sourceId}:${document.path}:${block.line}:${blockHash}`,
    title: block.title ?? basename(document.path, extname(document.path)),
    excerpt: clipExcerpt(block.text, 4_000),
    contextBefore: document.blocks[index - 1] ? clipExcerpt(document.blocks[index - 1].text, 1_500) : undefined,
    contextAfter: document.blocks[index + 1] ? clipExcerpt(document.blocks[index + 1].text, 1_500) : undefined,
    kind: block.kind,
    location,
    score,
  };
}

async function verifyExistingAncestors(root: string, target: string): Promise<void> {
  let current = target;
  while (current !== root) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new KnowledgeSourceError("PATH_OUTSIDE_SOURCE", "写入位置不能经过符号链接。");
      const actual = await realpath(current);
      if (!isInside(root, actual)) throw new KnowledgeSourceError("PATH_OUTSIDE_SOURCE", "写入位置超出知识源目录。");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    current = dirname(current);
  }
}

async function withWriteLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolveQueue) => { release = resolveQueue; });
  const queued = previous.then(() => current);
  writeQueues.set(key, queued);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (writeQueues.get(key) === queued) writeQueues.delete(key);
  }
}

async function readFromHandle(handle: FileHandle, maximumBytes: number, signal?: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < maximumBytes) {
    throwIfAborted(signal);
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maximumBytes - offset));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return Buffer.concat(chunks, offset);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new KnowledgeSourceError("TIMEOUT", "查询已取消。");
}

function transientPathError(error: unknown): boolean {
  return ["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "");
}

export function localDailyJournalPath(date: Date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `journals/${year}_${month}_${day}.md`;
}

export class FileGraphSource implements KnowledgeSource {
  private root = "";
  private singleFile = "";
  private readonly scope: FileGraphScope;

  constructor(
    scope: string | FileGraphScope,
    private readonly sourceId = "file-graph",
    private readonly sourceName = "本地 Markdown 知识源",
    private readonly projectId?: string,
  ) {
    this.scope = typeof scope === "string" ? { kind: "directory", path: scope } : scope;
  }

  async initialize(): Promise<void> {
    if (!this.scope.path || !isAbsolute(this.scope.path)) throw new KnowledgeSourceError("NOT_CONFIGURED", "文件知识源必须使用显式绝对路径。");
    try {
      const linkInfo = await lstat(this.scope.path);
      if (linkInfo.isSymbolicLink()) throw new KnowledgeSourceError("NOT_CONFIGURED", "项目路径不能是符号链接。");
      const canonical = await realpath(this.scope.path);
      const info = await stat(canonical);
      if (this.scope.kind === "file") {
        if (!info.isFile() || ![".md", ".markdown"].includes(extname(canonical).toLowerCase())) {
          throw new KnowledgeSourceError("NOT_CONFIGURED", "单文件项目只能使用已存在的 .md 或 .markdown 普通文件。");
        }
        this.root = dirname(canonical);
        this.singleFile = canonical;
      } else {
        if (!info.isDirectory()) throw new KnowledgeSourceError("NOT_CONFIGURED", "目录项目必须指向已存在的目录。");
        this.root = canonical;
        const directory = await opendir(this.root);
        await directory.close();
      }
    } catch (error) {
      if (error instanceof KnowledgeSourceError) throw error;
      throw new KnowledgeSourceError("NOT_CONFIGURED", "文件知识源必须指向可访问的已存在目录或 Markdown 文件。");
    }
  }

  descriptor(now: Date = new Date()): SourceDescriptor {
    return {
      id: this.sourceId,
      name: this.sourceName,
      ...(this.projectId ? { projectId: this.projectId } : {}),
      capabilities: ["read", "search", "write", "locate"],
      searchMode: "lexical-fallback",
      searchDescription: "本地文件标题与段落词法检索（未使用 embedding/rerank）",
      defaultWritePath: this.singleFile ? basename(this.singleFile) : localDailyJournalPath(now),
    };
  }

  private ensureInitialized(): void {
    if (!this.root) throw new KnowledgeSourceError("NOT_CONFIGURED", "文件知识源尚未初始化。");
  }

  private async markdownFiles(directory: string, state: TraversalState, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (state.stopped || state.files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await opendir(directory);
    } catch (error) {
      if (transientPathError(error)) return;
      throw error;
    }
    for await (const entry of entries) {
      throwIfAborted(signal);
      state.entries += 1;
      if (state.entries > MAX_DIRECTORY_ENTRIES) {
        state.stopped = true;
        break;
      }
      if (state.files.length >= MAX_FILES || entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const fullPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        const relativePath = relative(this.root, fullPath).replaceAll("\\", "/");
        if (OMITTED_DIRECTORIES.has(entry.name) || relativePath === "logseq/bak") continue;
        if (state.directories >= MAX_DIRECTORIES) {
          state.stopped = true;
          break;
        }
        state.directories += 1;
        await this.markdownFiles(fullPath, state, signal);
      } else if (entry.isFile() && [".md", ".markdown"].includes(extname(entry.name).toLowerCase())) {
        state.files.push(fullPath);
      }
      if (state.stopped || state.files.length >= MAX_FILES) break;
    }
  }

  private async readDocument(file: string, remainingBytes: number, remainingBlocks: number, signal?: AbortSignal): Promise<IndexedDocument | null | undefined> {
    throwIfAborted(signal);
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile() || openedInfo.size > MAX_FILE_BYTES) return undefined;
      if (openedInfo.size > remainingBytes || remainingBlocks <= 0) return null;

      const verifyPathIdentity = async (): Promise<string | undefined> => {
        const actual = await realpath(file);
        if (!isInside(this.root, actual)) return undefined;
        const pathInfo = await stat(actual);
        if (openedInfo.dev !== pathInfo.dev || openedInfo.ino !== pathInfo.ino) return undefined;
        return actual;
      };
      const actual = await verifyPathIdentity();
      if (!actual) return undefined;
      // Read only the size accepted above and only through the verified descriptor. If
      // the file grows concurrently, this keeps the per-file and total read budgets hard.
      const buffer = await readFromHandle(handle, openedInfo.size, signal);
      throwIfAborted(signal);
      if (!await verifyPathIdentity()) return undefined;
      const finalInfo = await handle.stat();
      const path = relative(this.root, actual).replaceAll("\\", "/");
      return {
        path,
        version: `${finalInfo.mtimeMs.toFixed(0)}-${hash(buffer).slice(0, 16)}`,
        bytes: buffer.length,
        blocks: parseMarkdown(buffer.toString("utf8"), remainingBlocks),
      };
    } catch (error) {
      if (signal?.aborted || (error as Error).name === "AbortError") throw new KnowledgeSourceError("TIMEOUT", "查询已取消。");
      if (transientPathError(error)) return undefined;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async search(query: string, limit: number, signal?: AbortSignal, intent?: SearchIntent): Promise<KnowledgeResult[]> {
    this.ensureInitialized();
    const cleanQuery = query.trim();
    if (!cleanQuery || cleanQuery.length > MAX_SEARCH_QUERY) {
      throw new KnowledgeSourceError("INVALID_INPUT", "查询必须为 1–500 个字符。");
    }
    throwIfAborted(signal);
    const cappedLimit = Math.max(1, Math.min(5, Math.floor(limit)));
    const traversal: TraversalState = { files: this.singleFile ? [this.singleFile] : [], directories: 1, entries: 0, stopped: false };
    if (!this.singleFile) await this.markdownFiles(this.root, traversal, signal);
    traversal.files.sort();
    const documents: IndexedDocument[] = [];
    let totalBytes = 0;
    let totalBlocks = 0;
    for (const file of traversal.files) {
      throwIfAborted(signal);
      const document = await this.readDocument(file, MAX_TOTAL_SEARCH_BYTES - totalBytes, MAX_BLOCKS - totalBlocks, signal);
      if (document === null) break;
      if (!document) continue;
      totalBytes += document.bytes;
      totalBlocks += document.blocks.length;
      documents.push(document);
      if (totalBytes >= MAX_TOTAL_SEARCH_BYTES || totalBlocks >= MAX_BLOCKS) break;
    }
    return documents.flatMap((document) => document.blocks.map((block, index) => ({ document, block, index, score: scoreBlock(cleanQuery, block, document.path) })))
      .filter((item) => item.score > 0 && matchesIntent(item.block.kind, intent))
      .sort((a, b) => b.score - a.score || a.document.path.localeCompare(b.document.path) || a.block.line - b.block.line)
      .slice(0, cappedLimit)
      .map((item) => resultFromBlock(item.document, item.block, item.index, item.score, this.sourceId, this.root));
  }

  async write(input: WriteInput): Promise<WriteReceipt> {
    try {
      this.ensureInitialized();
      const contentBytes = Buffer.byteLength(input.rawContent, "utf8");
      if (!input.rawContent.trim()) throw new KnowledgeSourceError("INVALID_INPUT", "记录内容不能为空。");
      if (contentBytes > MAX_WRITE_BYTES) throw new KnowledgeSourceError("PAYLOAD_TOO_LARGE", "单次记录不能超过 256 KiB。");
      if (input.target.sourceId !== this.sourceId) throw new KnowledgeSourceError("INVALID_INPUT", "目标知识源不匹配。");
      const relativePath = validateRelativePath(input.target.relativePath);
      const target = resolve(this.root, ...relativePath.split("/"));
      if (!isInside(this.root, target)) throw new KnowledgeSourceError("PATH_OUTSIDE_SOURCE", "写入位置超出知识源目录。");
      if (this.singleFile && (relativePath !== basename(this.singleFile) || target !== this.singleFile)) {
        throw new KnowledgeSourceError("PATH_OUTSIDE_SOURCE", "单文件项目只能写入所选 Markdown 文件。");
      }
      return await withWriteLock(target, () => this.appendVerified(target, relativePath, input.rawContent));
    } catch (error) {
      return { ok: false, ...publicError(error) };
    }
  }

  async locate(documentId: string): Promise<{ absolutePath: string }> {
    this.ensureInitialized();
    const relativePath = validateRelativePath(documentId);
    const candidate = resolve(this.root, ...relativePath.split("/"));
    if (!isInside(this.root, candidate) || (this.singleFile && candidate !== this.singleFile)) {
      throw new KnowledgeSourceError("PATH_OUTSIDE_SOURCE", "原文定位超出项目范围。");
    }
    try {
      const linkInfo = await lstat(candidate);
      if (linkInfo.isSymbolicLink()) throw new KnowledgeSourceError("PATH_OUTSIDE_SOURCE", "不能打开符号链接原文。");
      const actual = await realpath(candidate);
      const info = await stat(actual);
      if (!info.isFile() || !isInside(this.root, actual) || (this.singleFile && actual !== this.singleFile)) {
        throw new KnowledgeSourceError("PATH_OUTSIDE_SOURCE", "原文定位超出项目范围。");
      }
      return { absolutePath: actual };
    } catch (error) {
      if (error instanceof KnowledgeSourceError) throw error;
      if (transientPathError(error)) throw new KnowledgeSourceError("NOT_FOUND", "原文文件已移动或删除。");
      throw new KnowledgeSourceError("IO_ERROR", "无法验证原文文件。");
    }
  }

  private async appendVerified(target: string, relativePath: string, rawContent: string): Promise<WriteReceipt> {
    await verifyExistingAncestors(this.root, target);
    if (!this.singleFile) await mkdir(dirname(target), { recursive: true });
    await verifyExistingAncestors(this.root, dirname(target));
    return withCrossProcessLock(target, () => this.appendWhileLocked(target, relativePath, rawContent));
  }

  private async appendWhileLocked(target: string, relativePath: string, rawContent: string): Promise<WriteReceipt> {
    await verifyExistingAncestors(this.root, target);
    const flags = constants.O_APPEND | constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0);
    const handle = await open(target, flags, 0o600);
    try {
      const openedInfo = await handle.stat();
      const openedPath = await realpath(target);
      const pathInfo = await stat(openedPath);
      if (!openedInfo.isFile() || !isInside(this.root, openedPath) || openedInfo.dev !== pathInfo.dev || openedInfo.ino !== pathInfo.ino) {
        throw new KnowledgeSourceError("PATH_OUTSIDE_SOURCE", "写入位置在打开时发生变化，已拒绝写入。");
      }
      const startSize = openedInfo.size;
      if (startSize > MAX_FILE_BYTES) {
        throw new KnowledgeSourceError("PAYLOAD_TOO_LARGE", "目标 Markdown 文件已超过 2 MiB 写入上限。");
      }
      let prefix = "";
      if (startSize > 0) {
        const lastByte = Buffer.allocUnsafe(1);
        await handle.read(lastByte, 0, 1, startSize - 1);
        if (lastByte[0] !== 10) prefix = "\n";
      }
      const addition = Buffer.from(`${prefix}${rawContent}\n`, "utf8");
      if (startSize + addition.length > MAX_FILE_BYTES) {
        throw new KnowledgeSourceError("PAYLOAD_TOO_LARGE", "目标 Markdown 文件写入后不能超过 2 MiB。");
      }
      await handle.writeFile(addition);
      await handle.sync();

      // Capacity check, append, fsync, replay verification, and line calculation all stay
      // under the process-shared lock and use this already verified descriptor.
      const finalInfo = await handle.stat();
      if (finalInfo.size > MAX_FILE_BYTES) throw new KnowledgeSourceError("IO_ERROR", "写入后文件大小校验失败。");
      const saved = await readFromHandle(handle, finalInfo.size);
      const additionOffset = saved.indexOf(addition, startSize);
      if (additionOffset !== startSize) {
        throw new KnowledgeSourceError("IO_ERROR", "写入后校验失败，未返回成功回执。");
      }
      const version = `${finalInfo.mtimeMs.toFixed(0)}-${hash(saved).slice(0, 16)}`;
      const line = saved.subarray(0, additionOffset + Buffer.byteLength(prefix)).toString("utf8").split("\n").length;
      return {
        ok: true,
        location: { sourceId: this.sourceId, documentId: relativePath, path: relativePath, line, blockId: hash(rawContent).slice(0, 16), version },
        version,
      };
    } finally {
      await handle.close();
    }
  }
}
