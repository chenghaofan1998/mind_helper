import type { KnowledgeSource, SourceDescriptor } from "../src/knowledge/types.js";
import { KnowledgeSourceError } from "./errors.js";
import { FileGraphSource } from "./sources/fileGraph.js";
import { HttpConnectorSource } from "./sources/httpConnector.js";

export class SourceRegistry {
  private readonly sources = new Map<string, KnowledgeSource>();

  register(source: KnowledgeSource): void {
    const descriptor = source.descriptor();
    if (this.sources.has(descriptor.id)) throw new Error(`Duplicate knowledge source: ${descriptor.id}`);
    this.sources.set(descriptor.id, source);
  }

  descriptors(): SourceDescriptor[] {
    return [...this.sources.values()].map((source) => source.descriptor());
  }

  require(sourceId: string, capability: "search" | "write"): KnowledgeSource {
    const source = this.sources.get(sourceId);
    if (!source) throw new KnowledgeSourceError("NOT_FOUND", "未找到指定知识源。");
    if (!source.descriptor().capabilities.includes(capability) || (capability === "write" && !source.write)) {
      throw new KnowledgeSourceError("CAPABILITY_UNAVAILABLE", `该知识源不支持${capability === "write" ? "写入" : "检索"}。`);
    }
    return source;
  }
}

export async function registryFromEnvironment(environment: NodeJS.ProcessEnv = process.env): Promise<SourceRegistry> {
  const registry = new SourceRegistry();
  const graphKind = environment.AP_GRAPH_KIND ?? "markdown-files";
  if (!(["markdown-files", "logseq-files"] as string[]).includes(graphKind)) {
    throw new KnowledgeSourceError("NOT_CONFIGURED", "AP_GRAPH_KIND 只能是 markdown-files 或 logseq-files。");
  }
  if (environment.AP_GRAPH_KIND && !environment.AP_GRAPH_DIR) {
    throw new KnowledgeSourceError("NOT_CONFIGURED", "设置 AP_GRAPH_KIND 时必须同时设置 AP_GRAPH_DIR。");
  }
  if (environment.AP_GRAPH_DIR) {
    const sourceName = graphKind === "logseq-files" ? "Logseq 文件 Graph" : "本地 Markdown 知识源";
    const source = new FileGraphSource(environment.AP_GRAPH_DIR, "file-graph", sourceName);
    await source.initialize();
    registry.register(source);
  }
  if (environment.AP_CONNECTOR_URL) {
    const source = new HttpConnectorSource(environment.AP_CONNECTOR_URL, environment.AP_CONNECTOR_TOKEN);
    await source.initialize();
    registry.register(source);
  }
  return registry;
}
